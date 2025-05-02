import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, ScrollView, Image, ActivityIndicator, Platform } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import { FontAwesome } from '@expo/vector-icons';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as Location from 'expo-location';
import { getDocs, collection, query, where } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { formatTime } from '../utils/activityUtils';

const formatDate = () => {
  const date = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  return `${dayName}, ${day} ${month}`;
};

// Utility to calculate map region from coordinates
const calculateMapRegion = (coordinates) => {
  if (!coordinates || coordinates.length === 0) {
    return {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    };
  }

  const latitudes = coordinates.map(coord => coord.latitude);
  const longitudes = coordinates.map(coord => coord.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);

  const latitude = (minLat + maxLat) / 2;
  const longitude = (minLon + maxLon) / 2;
  const latitudeDelta = (maxLat - minLat) * 1.5 || 0.005;
  const longitudeDelta = (maxLon - minLon) * 1.5 || 0.005;

  return {
    latitude,
    longitude,
    latitudeDelta,
    longitudeDelta,
  };
};

// Utility to get the current week's dates
const getWeekDates = () => {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 (Sunday) to 6 (Saturday)
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek); // Set to Sunday

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    weekDates.push({
      day: date.getDate(),
      isToday: date.toDateString() === today.toDateString(),
      date: date,
    });
  }
  return weekDates;
};

const DashboardScreen = ({ navigateToActivity }) => {
  const [activityData, setActivityData] = useState({
    coordinates: [],
    distance: '0 km',
    duration: '0:00',
    steps: 0,
    activityType: 'walking',
    stats: {
      pace: '0:00/km',
      avgSpeed: '0 km/h',
    },
  });
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quests, setQuests] = useState([]);
  const [dailyQuest, setDailyQuest] = useState(null);
  const [questLoading, setQuestLoading] = useState(true);
  const [weeklyProgress, setWeeklyProgress] = useState([]);

  useEffect(() => {
    const getUserLocation = async () => {
      try {
        // Request foreground location permissions
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Permission to access location was denied');
          console.warn('Location permission denied');
          return;
        }

        // Fetch current position with options for accuracy and timeout
        let location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000, // Update interval in ms
          distanceInterval: 10, // Update distance in meters
        });
        setUserLocation(location.coords);
      } catch (err) {
        console.error('Location error:', err.message);
        setError('Failed to get location. Please ensure location services are enabled.');
      }
    };

    getUserLocation();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const user = auth.currentUser;

        if (!user) {
          setError('Please sign in to view activities');
          setLoading(false);
          return;
        }

        // Fetch activities for the entire week
        const weekDates = getWeekDates();
        const startOfWeek = new Date(weekDates[0].date);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(weekDates[6].date);
        endOfWeek.setHours(23, 59, 59, 999);

        const activitiesRef = collection(db, 'activities');
        const activitiesQuery = query(
          activitiesRef,
          where('userId', '==', user.uid),
          where('createdAt', '>=', startOfWeek),
          where('createdAt', '<=', endOfWeek)
        );
        const activitiesSnapshot = await getDocs(activitiesQuery);

        const activitiesData = activitiesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Process latest activity
        if (activitiesData.length > 0) {
          const latestActivity = activitiesData.sort((a, b) =>
            (b.createdAt?.toDate() || new Date()) - (a.createdAt?.toDate() || new Date())
          )[0];

          const formattedDistance = latestActivity.distance
            ? `${parseFloat(latestActivity.distance).toFixed(2)} km`
            : '0 km';
          const formattedDuration = latestActivity.duration
            ? formatTime(latestActivity.duration)
            : '0:00';
          const formattedPace = latestActivity.pace
            ? formatTime(latestActivity.pace) + '/km'
            : '0:00/km';

          setActivityData({
            coordinates: latestActivity.coordinates || [],
            distance: formattedDistance,
            duration: formattedDuration,
            steps: latestActivity.steps || 0,
            activityType: latestActivity.activityType || 'walking',
            stats: {
              pace: formattedPace,
              avgSpeed: latestActivity.avgSpeed ? `${latestActivity.avgSpeed.toFixed(1)} km/h` : '0 km/h',
            },
          });
        }

        // Fetch quests
        const questsRef = collection(db, 'quests');
        const questsSnapshot = await getDocs(questsRef);
        const questsData = questsSnapshot.docs.map(doc => doc.data());
        setQuests(questsData);

        // Find daily quest
        const todayQuest = questsData.find(q => q.type === 'daily');
        setDailyQuest(todayQuest);

        // Calculate weekly progress for daily quests
        if (todayQuest) {
          const progress = weekDates.map(({ date }) => {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            const dayActivities = activitiesData.filter((act) => {
              const actDate = act.createdAt?.toDate();
              return actDate >= startOfDay && actDate <= endOfDay;
            });

            let totalValue = 0;
            if (todayQuest.unit === 'steps') {
              totalValue = dayActivities.reduce((sum, act) => sum + (act.steps || 0), 0);
            } else if (todayQuest.unit === 'distance') {
              totalValue = dayActivities.reduce((sum, act) => sum + (act.distance || 0), 0);
            }

            const progress = Math.min(totalValue / todayQuest.goal, 1);
            return {
              date,
              progress,
              completed: progress >= 1,
            };
          });
          setWeeklyProgress(progress);
        }

        setLoading(false);
        setQuestLoading(false);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message);
        setLoading(false);
        setQuestLoading(false);
      }
    };

    fetchData();
  }, []);

  const calculateQuestProgress = () => {
    if (!dailyQuest || !activityData) return 0;

    const currentValue = dailyQuest.unit === 'steps'
      ? activityData.steps
      : parseFloat(activityData.distance);

    const progress = Math.min(currentValue / dailyQuest.goal, 1);
    return progress;
  };

  const getQuestStatus = () => {
    const progress = calculateQuestProgress();
    if (progress >= 1) return 'completed';
    if (progress > 0) return 'in_progress';
    return 'not_started';
  };

  const getCurrentQuestValue = () => {
    if (!dailyQuest) return 0;
    return dailyQuest.unit === 'steps'
      ? Math.min(activityData.steps, dailyQuest.goal)
      : Math.min(parseFloat(activityData.distance), dailyQuest.goal);
  };

  if (loading || questLoading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <CustomText style={twrnc`text-white mt-4`}>Loading Dashboard...</CustomText>
      </View>
    );
  }

  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <CustomText style={twrnc`text-red-500`}>Error: {error}</CustomText>
      </View>
    );
  }

  const weekDates = getWeekDates();

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <ScrollView style={twrnc`flex-1`}>
        <View style={twrnc`px-5 mt-4`}>
          <View style={twrnc`flex-row justify-between items-center mb-4`}>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>
              Your Progress
            </CustomText>
            <View style={twrnc`flex-row items-center bg-[#2A2E3A] rounded-full px-3 py-1`}>
              <CustomText style={twrnc`text-white text-sm`}>Week</CustomText>
            </View>
          </View>

          <View style={twrnc`flex-row justify-between mb-5`}>
            {weekDates.map((day, index) => {
              const progressData = weeklyProgress[index] || { progress: 0, completed: false };
              const isCompleted = progressData.completed;
              const progress = progressData.progress;

              return (
                <View
                  key={index}
                  style={twrnc`items-center justify-center rounded-full w-10 h-10 
                    ${isCompleted ? 'bg-[#FFC107]' : progress > 0 ? 'bg-[#FFC107] bg-opacity-50' : 'bg-[#2A2E3A]'}
                    ${day.isToday ? 'border-2 border-[#4361EE]' : ''}`}
                >
                  {isCompleted ? (
                    <FontAwesome name="check" size={20} color="#121826" />
                  ) : progress > 0 ? (
                    <CustomText
                      weight={day.isToday ? 'bold' : 'medium'}
                      style={twrnc`text-white text-xs`}
                    >
                      {Math.round(progress * 100)}%
                    </CustomText>
                  ) : (
                    <CustomText
                      weight={day.isToday ? 'bold' : 'medium'}
                      style={twrnc`text-white`}
                    >
                      {day.day}
                    </CustomText>
                  )}
                </View>
              );
            })}
          </View>

          <View style={twrnc`flex-row justify-between bg-[#2A2E3A] rounded-xl p-4 mb-5`}>
            <View style={twrnc`items-center`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                {activityData.steps.toLocaleString()}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 text-xs`}>
                Today's Steps
              </CustomText>
            </View>
            <View style={twrnc`items-center border-l border-r border-[#3A3F4B] px-8`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                {activityData.distance}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 text-xs`}>
                Distance
              </CustomText>
            </View>
            <View style={twrnc`items-center`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                {activityData.duration}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 text-xs`}>
                Active time
              </CustomText>
            </View>
          </View>
        </View>

        {/* Daily Quest Card */}
        {dailyQuest && (
          <View style={twrnc`mx-5 bg-[#2A2E3A] rounded-xl p-4 mb-5`}>
            <View style={twrnc`flex-row justify-between items-center mb-2`}>
              <View style={twrnc`flex-row items-center flex-1`}>
                <View style={twrnc`bg-[#FFC107] rounded-full p-2 mr-3`}>
                  <FontAwesome name="trophy" size={18} color="#121826" />
                </View>
                <View style={twrnc`flex-1`}>
                  <CustomText
                    weight="bold"
                    style={twrnc`text-white text-base mb-1`}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {dailyQuest.title}
                  </CustomText>
                  <CustomText
                    style={twrnc`text-gray-400 text-xs`}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {dailyQuest.description}
                  </CustomText>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  twrnc`rounded-full px-4 py-2 min-w-[100px] items-center`,
                  getQuestStatus() === 'completed'
                    ? twrnc`bg-[#4CAF50]`
                    : twrnc`bg-[#FFC107]`
                ]}
                onPress={navigateToActivity}
              >
                <CustomText
                  weight="bold"
                  style={twrnc`text-[#121826] text-sm`}
                >
                  {getQuestStatus() === 'completed' ? 'Completed ✓' : 'Start Now'}
                </CustomText>
              </TouchableOpacity>
            </View>

            <View style={twrnc`flex-row items-center justify-between mt-2`}>
              <View style={twrnc`flex-1 mr-2`}>
                <View style={twrnc`h-2 bg-[#3A3F4B] rounded-full`}>
                  <View style={[
                    twrnc`h-2 rounded-full`,
                    {
                      width: `${calculateQuestProgress() * 100}%`,
                      backgroundColor: getQuestStatus() == 'completed' ? '#4CAF50' : '#FFC107'
                    }
                  ]} />
                </View>
              </View>
              <CustomText
                style={[
                  twrnc`text-xs font-medium`,
                  getQuestStatus() === 'completed'
                    ? twrnc`text-[#4CAF50]`
                    : twrnc`text-[#FFC107]`
                ]}
              >
                {Math.round(calculateQuestProgress() * 100)}% • {getCurrentQuestValue()}/{dailyQuest.goal} {dailyQuest.unit}
              </CustomText>
            </View>
          </View>
        )}

        <View style={twrnc`px-5 mb-20`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>
            Last Activity
          </CustomText>
          <View style={twrnc`flex-row justify-between mb-4`}>
            <View style={twrnc`bg-[#2A2E3A] rounded-xl overflow-hidden w-1/2 mr-2`}>
              {activityData.coordinates.length > 0 ? (
                <MapView
                  style={twrnc`w-full h-40`}
                  initialRegion={calculateMapRegion(activityData.coordinates)}
                  customMapStyle={[
                    { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
                    { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
                    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
                    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFC107' }] },
                    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
                  ]}
                  provider="google"
                  scrollEnabled={true}
                  zoomEnabled={true}
                  pitchEnabled={true}
                  rotateEnabled={true}
                >
                  <Polyline
                    coordinates={activityData.coordinates}
                    strokeColor="#4361EE"
                    strokeWidth={3}
                  />
                </MapView>
              ) : (
                <View style={twrnc`w-full h-40 bg-[#2A2E3A] justify-center items-center p-4`}>
                  <FontAwesome name="map" size={24} color="#6B7280" style={twrnc`mb-2`} />
                  <CustomText style={twrnc`text-gray-400 text-sm text-center mb-2`}>
                    No recent activity. Start tracking now!
                  </CustomText>
                  <TouchableOpacity
                    style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`}
                    onPress={navigateToActivity}
                  >
                    <CustomText style={twrnc`text-white text-sm`}>Start Activity</CustomText>
                  </TouchableOpacity>
                </View>
              )}
              <View style={twrnc`p-3`}>
                <CustomText style={twrnc`text-[#FFC107] font-medium`}>
                  {activityData.distance} • {activityData.duration}
                  {(activityData.activityType === 'walking' || activityData.activityType === 'jogging') &&
                    ` • ${activityData.steps} steps`}
                </CustomText>
              </View>
            </View>

            <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 w-1/2`}>
              <CustomText weight="semibold" style={twrnc`text-white text-base mb-3`}>
                {activityData.activityType.charAt(0).toUpperCase() + activityData.activityType.slice(1)}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 text-sm mb-2`}>
                {formatDate()}
              </CustomText>
              <CustomText style={twrnc`text-[#FFC107] font-medium mb-2`}>
                Pace: {activityData.stats.pace} • Speed: {activityData.stats.avgSpeed}
              </CustomText>
              <TouchableOpacity onPress={() => navigateToActivity({
                activityType: activityData.activityType,
                coordinates: activityData.coordinates,
                stats: {
                  distance: parseFloat(activityData.distance) * 1000,
                  duration: activityData.duration
                    .split(':')
                    .reduce((acc, time, index) => acc + (parseInt(time) * (index === 0 ? 60 : 1)), 0),
                  pace: activityData.stats.pace.replace('/km', '')
                    .split(':')
                    .reduce((acc, time, index) => acc + (parseInt(time) * (index === 0 ? 60 : 1)), 0),
                  avgSpeed: parseFloat(activityData.stats.avgSpeed),
                  steps: activityData.steps,
                },
              })}>
                <CustomText style={twrnc`text-[#4361EE] text-sm font-medium`}>
                  View Details
                </CustomText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

export default DashboardScreen;