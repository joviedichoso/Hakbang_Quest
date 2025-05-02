import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Alert, Platform, AppState, Dimensions, BackHandler } from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Pedometer from 'expo-sensors';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import { FontAwesome } from '@expo/vector-icons';
import Icon from 'react-native-vector-icons/FontAwesome';
import { calculateDistance, formatTime } from '../utils/activityUtils';
import { db, auth } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const { width } = Dimensions.get('window');
const isAndroid = Platform.OS === 'android';
const isSmallDevice = width < 375;

const MapScreen = ({ navigateToActivity, navigateToDashboard, params = {} }) => {
  const {
    activityType = 'walking',
    activityColor = '#4361EE',
    targetDistance = '5.00',
    targetTime = '30',
    tracking: initialTracking = false,
    initialCoordinates = [],
    initialStats = { distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0 },
  } = params;

  const [coordinates, setCoordinates] = useState(initialCoordinates);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(initialTracking);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [watchId, setWatchId] = useState(null);
  const [gpsSignal, setGpsSignal] = useState('Unknown');
  const [pedometerAvailable, setPedometerAvailable] = useState(false);

  const mapRef = useRef(null);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const lastUpdateTimeRef = useRef(Date.now());
  const lowAccuracyCountRef = useRef(0);
  const pedometerSubscriptionRef = useRef(null);
  const rawCoordinatesRef = useRef([]); // Fix: Use useRef for rawCoordinates

  // Strava-inspired settings: Adjust accuracy and interval by activity type
  const locationAccuracy =
    activityType === 'running' || activityType === 'jogging'
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.High;
  const locationDistanceInterval = 3;
  const locationTimeInterval = activityType === 'cycling' ? 1000 : 500;

  const activityConfigs = {
    walking: { icon: 'walking', color: '#4361EE', strokeColor: '#4361EE' },
    running: { icon: 'running', color: '#EF476F', strokeColor: '#EF476F' },
    cycling: { icon: 'bicycle', color: '#06D6A0', strokeColor: '#06D6A0' },
    jogging: { icon: 'running', color: '#FFD166', strokeColor: '#FFD166' },
  };

  const currentActivity = activityConfigs[activityType] || activityConfigs.walking;
  const accuracyThreshold = activityType === 'running' ? 15 : 20;
  const maxSpeed = activityType === 'cycling' ? 20 : 8;

  useEffect(() => {
    const backAction = () => {
      if (tracking) {
        Alert.alert(
          'Stop Tracking',
          'Are you sure you want to stop tracking and exit?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Exit',
              onPress: () => {
                stopTracking();
                navigateToActivity();
              },
            },
          ]
        );
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [tracking]);

  useEffect(() => {
    const initialize = async () => {
      const pedometerStatus = await Pedometer.isAvailableAsync();
      setPedometerAvailable(pedometerStatus);

      if (initialTracking) {
        await startTracking();
      } else {
        await getCurrentLocation();
      }
    };
    initialize();

    // Strava-style setup guidance
    if (!initialTracking) {
      Alert.alert(
        'Optimize GPS Accuracy',
        'For best results, keep your phone in an open position (e.g., armband, bike mount) and avoid pockets or bags.',
        [{ text: 'OK' }]
      );
    }

    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'background' && tracking) {
        if (isAndroid) {
          Alert.alert('Background Tracking', 'Tracking may be less accurate in background', [
            { text: 'OK' },
          ]);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription?.remove();
      if (watchId) watchId.remove();
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (pedometerSubscriptionRef.current) pedometerSubscriptionRef.current.remove();
    };
  }, []);

  const checkLocationServices = async () => {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      Alert.alert(
        'Location Services Disabled',
        'Please enable location services to use this feature',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Location.enableNetworkProviderAsync() },
        ]
      );
      return false;
    }
    return true;
  };

  const requestPermissions = async () => {
    setLoading(true);
    try {
      const servicesEnabled = await checkLocationServices();
      if (!servicesEnabled) return false;

      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'This app requires location access to track your activity', [
          { text: 'OK', style: 'cancel' },
        ]);
        return false;
      }

      if (isAndroid) {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        if (backgroundStatus !== 'granted') {
          Alert.alert(
            'Background Permission',
            'For continuous tracking, please enable background location in app settings',
            [{ text: 'OK', style: 'cancel' }]
          );
        }
      }

      if ((activityType === 'walking' || activityType === 'jogging') && pedometerAvailable) {
        const { status: pedometerStatus } = await Pedometer.requestPermissionsAsync();
        if (pedometerStatus !== 'granted') {
          Alert.alert('Pedometer Permission Denied', 'Step counting requires motion permissions', [
            { text: 'OK', style: 'cancel' },
          ]);
          return false;
        }
      }

      return true;
    } catch (err) {
      console.error('Permission error:', err);
      Alert.alert('Error', 'Failed to request permissions');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const getCurrentLocation = async () => {
    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: locationAccuracy,
        timeout: 10000,
      });

      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      };

      setCurrentLocation(newRegion);
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }
      return location;
    } catch (err) {
      console.error(err);
      setError('Failed to get location. Ensure GPS is enabled');
      throw err;
    }
  };

  const smoothCoordinate = (prevCoords, newCoord) => {
    if (prevCoords.length < 5) return newCoord;
    const recentCoords = prevCoords.slice(-5).concat([newCoord]);
    const avgLat = recentCoords.reduce((sum, coord) => sum + coord.latitude, 0) / recentCoords.length;
    const avgLon = recentCoords.reduce((sum, coord) => sum + coord.longitude, 0) / recentCoords.length;
    return { ...newCoord, latitude: avgLat, longitude: avgLon };
  };

  const calculateMetrics = (distance, duration) => {
    const pace = duration > 0 ? duration / (distance / 1000) : 0;
    const avgSpeed = duration > 0 ? (distance / duration) * 3.6 : 0;
    return { pace, avgSpeed };
  };

  const getSignalStrength = (accuracy) => {
    if (!accuracy) return 'Unknown';
    if (accuracy < 8) return 'Excellent';
    if (accuracy < 15) return 'Good';
    if (accuracy < 25) return 'Fair';
    return 'Poor';
  };

  const startTracking = async () => {
    setIsTrackingLoading(true);
    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) {
        setError('Location permissions not granted');
        setIsTrackingLoading(false);
        return;
      }

      const initialLocation = await getCurrentLocation();
      if (!initialLocation) {
        setError('Failed to get initial location');
        setIsTrackingLoading(false);
        return;
      }

      setCoordinates([
        {
          latitude: initialLocation.coords.latitude,
          longitude: initialLocation.coords.longitude,
          timestamp: initialLocation.timestamp,
          accuracy: initialLocation.coords.accuracy,
        },
      ]);

      startTimeRef.current = new Date();
      lastUpdateTimeRef.current = Date.now();
      lowAccuracyCountRef.current = 0;
      rawCoordinatesRef.current = []; // Reset rawCoordinates
      let missedUpdateCount = 0;
      let validUpdateCount = 0;
      let recentUpdateIntervals = [];
      const maxIntervals = 5;
      const maxMissedUpdates = 5; // Strava-like tolerance

      setTracking(true);

      intervalRef.current = setInterval(() => {
        setStats((prev) => {
          const duration = Math.floor((new Date() - startTimeRef.current) / 1000);
          const metrics = calculateMetrics(prev.distance, duration);
          return { ...prev, duration, ...metrics };
        });
      }, 1000);

      if (pedometerAvailable && (activityType === 'walking' || activityType === 'jogging')) {
        pedometerSubscriptionRef.current = Pedometer.watchStepCount((result) => {
          setStats((prev) => {
            const stepLength = activityType === 'walking' ? 0.7 : 1.0; // Meters per step
            const pedometerDistance = result.steps * stepLength;
            // Use pedometer distance during signal loss
            if (missedUpdateCount >= maxMissedUpdates && prev.distance < pedometerDistance) {
              const duration = Math.floor((new Date() - startTimeRef.current) / 1000);
              return {
                ...prev,
                steps: result.steps,
                distance: pedometerDistance,
                ...calculateMetrics(pedometerDistance, duration),
              };
            }
            return { ...prev, steps: result.steps };
          });
        });
      }

      const id = await Location.watchPositionAsync(
        {
          accuracy: locationAccuracy,
          distanceInterval: locationDistanceInterval,
          timeInterval: locationTimeInterval,
        },
        (location, error) => {
          const now = Date.now();
          if (error) {
            setError('GPS error: ' + error.message);
            missedUpdateCount = maxMissedUpdates;
            return;
          }

          // Store raw data for post-processing
          rawCoordinatesRef.current.push({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            timestamp: location.timestamp,
          });

          // Dynamic timeout
          if (recentUpdateIntervals.length >= maxIntervals) {
            recentUpdateIntervals.shift();
          }
          if (lastUpdateTimeRef.current) {
            recentUpdateIntervals.push(now - lastUpdateTimeRef.current);
          }
          const avgInterval = recentUpdateIntervals.length
            ? recentUpdateIntervals.reduce((sum, val) => sum + val, 0) / recentUpdateIntervals.length
            : locationTimeInterval;
          const dynamicTimeout = avgInterval * 3;

          const accuracy = location.coords.accuracy;
          if (now - lastUpdateTimeRef.current > dynamicTimeout || accuracy > 50) {
            missedUpdateCount += 1;
            if (missedUpdateCount >= maxMissedUpdates) {
              setError('GPS signal lost. Waiting for signal...');
              setGpsSignal('Poor');
              setTimeout(
                () =>
                  Alert.alert(
                    'GPS Issue',
                    'Check GPS settings, move to an open area, or ensure your phone is not in a pocket.'
                  ),
                30000
              );
            } else {
              setError('Weak GPS signal. Move to an open area.');
              setGpsSignal('Weak');
            }
            return;
          }

          // Valid update: require 2 good updates to clear error
          if (accuracy < accuracyThreshold) {
            validUpdateCount += 1;
            if (validUpdateCount >= 2) {
              missedUpdateCount = 0;
              validUpdateCount = 0;
              setError(null);
            }
          } else {
            validUpdateCount = 0;
          }

          setGpsSignal(getSignalStrength(accuracy));
          lastUpdateTimeRef.current = now;

          const newCoordinate = smoothCoordinate(coordinates, {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            timestamp: location.timestamp,
          });

          setCoordinates((prev) => {
            if (prev.length === 0) return [newCoordinate];
            const lastPoint = prev[prev.length - 1];

            const distanceIncrement = calculateDistance(
              lastPoint.latitude,
              lastPoint.longitude,
              newCoordinate.latitude,
              newCoordinate.longitude
            );

            const timeDiff = (newCoordinate.timestamp - lastPoint.timestamp) / 1000;
            const speed = distanceIncrement / (timeDiff || 1);

            if (
              distanceIncrement < 3 ||
              speed > maxSpeed ||
              newCoordinate.accuracy > accuracyThreshold
            ) {
              lowAccuracyCountRef.current += 1;
              if (lowAccuracyCountRef.current > 5) {
                setError('Poor GPS accuracy. Please move to an open area.');
              }
              return prev;
            }

            lowAccuracyCountRef.current = 0;

            setStats((prevStats) => {
              const newDistance = prevStats.distance + distanceIncrement;
              const duration = Math.floor((new Date() - startTimeRef.current) / 1000);
              const metrics = calculateMetrics(newDistance, duration);
              return { ...prevStats, distance: newDistance, duration, ...metrics };
            });

            const newRegion = {
              latitude: newCoordinate.latitude,
              longitude: newCoordinate.longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            };
            mapRef.current?.animateToRegion(newRegion, 500);

            return [...prev, newCoordinate];
          });
        }
      );

      setWatchId(id);
    } catch (err) {
      console.error('Start tracking error:', err);
      setError('Failed to start tracking: ' + err.message);
      stopTracking();
    } finally {
      setIsTrackingLoading(false);
    }
  };

  const stopTracking = async () => {
    setIsTrackingLoading(true);
    try {
      if (watchId) {
        watchId.remove();
        setWatchId(null);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (pedometerSubscriptionRef.current) {
        pedometerSubscriptionRef.current.remove();
        pedometerSubscriptionRef.current = null;
      }

      // Post-process coordinates (Strava-like)
      const filteredCoordinates = rawCoordinatesRef.current
        .filter((coord) => coord.accuracy < 50)
        .filter((coord, index) => {
          if (index === 0) return true;
          const prevCoord = rawCoordinatesRef.current[index - 1];
          const distance = calculateDistance(
            prevCoord.latitude,
            prevCoord.longitude,
            coord.latitude,
            coord.longitude
          );
          const timeDiff = (coord.timestamp - prevCoord.timestamp) / 1000;
          const speed = distance / (timeDiff || 1);
          return distance > 3 && speed < maxSpeed;
        });

      // Smooth coordinates
      const smoothedCoordinates = filteredCoordinates.map((coord, index, arr) => {
        if (index < 2 || index >= arr.length - 2) return coord;
        const window = arr.slice(index - 2, index + 3);
        const avgLat = window.reduce((sum, c) => sum + c.latitude, 0) / window.length;
        const avgLon = window.reduce((sum, c) => sum + c.longitude, 0) / window.length;
        return { ...coord, latitude: avgLat, longitude: avgLon };
      });

      // Recalculate distance
      let newDistance = 0;
      for (let i = 1; i < smoothedCoordinates.length; i++) {
        newDistance += calculateDistance(
          smoothedCoordinates[i - 1].latitude,
          smoothedCoordinates[i - 1].longitude,
          smoothedCoordinates[i].latitude,
          smoothedCoordinates[i].longitude
        );
      }

      setCoordinates(smoothedCoordinates);
      setStats((prev) => ({
        ...prev,
        distance: newDistance,
        ...calculateMetrics(newDistance, prev.duration),
      }));

      setTracking(false);
      setGpsSignal('Unknown');
      rawCoordinatesRef.current = []; // Reset after processing
    } catch (err) {
      console.error('Stop tracking error:', err);
      setError('Failed to stop tracking: ' + err.message);
    } finally {
      setIsTrackingLoading(false);
    }
  };

  const centerMap = async () => {
    try {
      const location = await getCurrentLocation();
      if (location && mapRef.current) {
        mapRef.current.animateToRegion(
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          },
          1000
        );
      }
    } catch (err) {
      console.error('Center map error:', err);
    }
  };

  const saveActivity = async () => {
    setIsTrackingLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        Alert.alert('Error', 'You must be logged in to save activities');
        setIsTrackingLoading(false);
        return;
      }

      const activityData = {
        userId: user.uid,
        activityType,
        distance: stats.distance / 1000,
        duration: stats.duration,
        pace: stats.pace,
        avgSpeed: stats.avgSpeed,
        steps: stats.steps || 0,
        coordinates: coordinates.map((coord) => ({
          latitude: coord.latitude,
          longitude: coord.longitude,
          timestamp: coord.timestamp,
        })),
        targetDistance: parseFloat(targetDistance),
        targetTime: parseInt(targetTime),
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'activities'), activityData);

      Alert.alert(
        'Activity Saved',
        `You completed ${(stats.distance / 1000).toFixed(2)} km of ${activityType}${
          stats.steps ? ` with ${stats.steps} steps` : ''
        }`,
        [{ text: 'OK', onPress: navigateToActivity }]
      );
    } catch (error) {
      console.error('Error saving activity:', error);
      Alert.alert('Error', 'Failed to save activity. Please try again.');
    } finally {
      setIsTrackingLoading(false);
    }
  };

  const returnToActivity = () => {
    navigateToActivity({
      activityType,
      distance: targetDistance,
      time: targetTime,
      coordinates,
      stats,
      tracking,
    });
  };

  if (loading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size={isSmallDevice ? 'small' : 'large'} color={currentActivity.color} />
        <CustomText style={twrnc`text-white mt-4 ${isSmallDevice ? 'text-sm' : 'text-base'}`}>
          Initializing GPS...
        </CustomText>
      </View>
    );
  }

  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center p-4`}>
        <FontAwesome name="exclamation-circle" size={48} color="#EF4444" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-white text-center mb-4 ${isSmallDevice ? 'text-sm' : 'text-base'}`}>
          {error}
        </CustomText>
        <TouchableOpacity
          style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg ${isAndroid ? 'active:opacity-70' : ''}`}
          activeOpacity={0.7}
          onPress={() => {
            setError(null);
            getCurrentLocation();
          }}
        >
          <CustomText style={twrnc`text-white ${isSmallDevice ? 'text-sm' : 'text-base'}`}>
            Try Again
          </CustomText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <View style={twrnc`flex-row items-center justify-between p-4 bg-[${currentActivity.color}]`}>
        <TouchableOpacity
          onPress={returnToActivity}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          disabled={isTrackingLoading}
        >
          <Icon
            name="angle-left"
            size={isSmallDevice ? 24 : 28}
            color="#FFFFFF"
            style={twrnc`${isAndroid ? 'mt-1' : ''}`}
          />
        </TouchableOpacity>

        <CustomText
          weight="semibold"
          style={twrnc`text-white ${isSmallDevice ? 'text-lg' : 'text-xl'}`}
        >
          {activityType.charAt(0).toUpperCase() + activityType.slice(1)}
        </CustomText>

        <TouchableOpacity
          onPress={centerMap}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          disabled={isTrackingLoading}
        >
          <FontAwesome name="compass" size={isSmallDevice ? 20 : 24} color="#fff" />
        </TouchableOpacity>
      </View>

      <MapView
        ref={mapRef}
        style={twrnc`flex-1`}
        provider={PROVIDER_GOOGLE}
        initialRegion={currentLocation}
        region={currentLocation}
        showsUserLocation={true}
        showsMyLocationButton={false}
        followsUserLocation={tracking}
        loadingEnabled={true}
        moveOnMarkerPress={false}
        toolbarEnabled={false}
        mapType="standard"
        customMapStyle={[
          {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ color: '#808080' }],
          },
          {
            featureType: 'road',
            elementType: 'labels.text.fill',
            stylers: [{ color: '#FFFFFF' }],
          },
          {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#0e1626' }],
          },
        ]}
      >
        {coordinates.length > 0 && (
          <>
            <Polyline
              coordinates={coordinates}
              strokeColor={currentActivity.strokeColor}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
            />
            {coordinates.length > 1 && (
              <>
                <Marker coordinate={coordinates[0]}>
                  <View style={twrnc`bg-green-500 p-2 rounded-full`}>
                    <FontAwesome name="flag" size={16} color="white" />
                  </View>
                </Marker>
                <Marker coordinate={coordinates[coordinates.length - 1]}>
                  <View style={twrnc`bg-red-500 p-2 rounded-full`}>
                    <FontAwesome name="flag" size={16} color="white" />
                  </View>
                </Marker>
              </>
            )}
          </>
        )}
      </MapView>

      <View style={twrnc`absolute bottom-4 left-4 right-4`}>
        <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 shadow-lg ${isAndroid ? 'elevation-5' : ''}`}>
          {/* Strava-style signal strength indicator */}
          <View style={twrnc`flex-row items-center justify-center mb-2`}>
            <FontAwesome
              name="signal"
              size={isSmallDevice ? 16 : 18}
              color={
                gpsSignal === 'Excellent' ? '#22C55E' :
                gpsSignal === 'Good' ? '#3B82F6' :
                gpsSignal === 'Fair' ? '#F59E0B' :
                gpsSignal === 'Poor' || gpsSignal === 'Weak' ? '#EF4444' :
                '#6B7280'
              }
            />
            <CustomText style={twrnc`text-white ml-2 ${isSmallDevice ? 'text-xs' : 'text-sm'}`}>
              GPS Signal: {gpsSignal}
            </CustomText>
          </View>

          <View style={twrnc`flex-row justify-between mb-3 flex-wrap`}>
            <View style={twrnc`items-center ${isSmallDevice ? 'w-1/2 mb-2' : 'w-1/4'}`}>
              <CustomText style={twrnc`text-white ${isSmallDevice ? 'text-xs' : 'text-sm'} mb-1`}>
                Distance
              </CustomText>
              <CustomText
                weight="bold"
                style={twrnc`text-white ${isSmallDevice ? 'text-base' : 'text-lg'}`}
              >
                {(stats.distance / 1000).toFixed(2)} km
              </CustomText>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? 'text-2xs' : 'text-xs'}`}>
                Target: {targetDistance} km
              </CustomText>
            </View>

            <View style={twrnc`items-center ${isSmallDevice ? 'w-1/2 mb-2' : 'w-1/4'}`}>
              <CustomText style={twrnc`text-white ${isSmallDevice ? 'text-xs' : 'text-sm'} mb-1`}>
                Duration
              </CustomText>
              <CustomText
                weight="bold"
                style={twrnc`text-white ${isSmallDevice ? 'text-base' : 'text-lg'}`}
              >
                {formatTime(stats.duration)}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? 'text-2xs' : 'text-xs'}`}>
                Target: {targetTime} min
              </CustomText>
            </View>

            <View style={twrnc`items-center ${isSmallDevice ? 'w-1/2 mb-2' : 'w-1/4'}`}>
              <CustomText style={twrnc`text-white ${isSmallDevice ? 'text-xs' : 'text-sm'} mb-1`}>
                Pace
              </CustomText>
              <CustomText
                weight="bold"
                style={twrnc`text-white ${isSmallDevice ? 'text-base' : 'text-lg'}`}
              >
                {formatTime(stats.pace)} /km
              </CustomText>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? 'text-2xs' : 'text-xs'}`}>
                {stats.avgSpeed.toFixed(1)} km/h
              </CustomText>
            </View>

            <View style={twrnc`items-center ${isSmallDevice ? 'w-1/2 mb-2' : 'w-1/4'}`}>
              <CustomText style={twrnc`text-white ${isSmallDevice ? 'text-xs' : 'text-sm'} mb-1`}>
                {activityType === 'walking' || activityType === 'jogging' ? 'Steps' : 'GPS Signal'}
              </CustomText>
              <CustomText
                weight="bold"
                style={twrnc`text-white ${isSmallDevice ? 'text-base' : 'text-lg'}`}
              >
                {activityType === 'walking' || activityType === 'jogging' ? stats.steps || 0 : gpsSignal}
              </CustomText>
            </View>
          </View>

          <TouchableOpacity
            style={twrnc`py-3 rounded-lg items-center flex-row justify-center bg-[${currentActivity.color}] ${
              isAndroid ? 'active:opacity-70' : ''
            } ${isTrackingLoading ? 'opacity-50' : ''}`}
            activeOpacity={0.7}
            onPress={tracking ? () => { stopTracking(); saveActivity(); } : startTracking}
            disabled={isTrackingLoading}
          >
            {isTrackingLoading ? (
              <ActivityIndicator
                size={isSmallDevice ? 'small' : 'large'}
                color="white"
                style={twrnc`${isSmallDevice ? 'mr-1' : 'mr-2'}`}
              />
            ) : (
              <FontAwesome
                name={tracking ? 'stop' : 'play'}
                size={isSmallDevice ? 18 : 20}
                color="white"
                style={twrnc`${isSmallDevice ? 'mr-1' : 'mr-2'}`}
              />
            )}
            <CustomText
              weight="bold"
              style={twrnc`text-white ${isSmallDevice ? 'text-base' : 'text-lg'}`}
            >
              {isTrackingLoading
                ? tracking
                  ? 'Saving...'
                  : 'Starting...'
                : tracking
                ? 'Stop & Save'
                : 'Start Tracking'}
            </CustomText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default MapScreen;