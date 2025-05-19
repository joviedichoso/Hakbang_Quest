"use client"

import { useState, useEffect, useRef } from "react"
import {
  View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  AppState,
  Dimensions,
  BackHandler,
  Animated,
  Easing,
  PanResponder,
} from "react-native"
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from "react-native-maps"
import * as Location from "expo-location"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import CustomModal from "../components/CustomModal"
import { FontAwesome } from "@expo/vector-icons"
import Icon from "react-native-vector-icons/FontAwesome"
import { Ionicons } from "@expo/vector-icons"
// Update the imports to include the new pace calculation functions
import { calculateDistance, formatTime, calculatePace, formatPace } from "../utils/activityUtils"
import { db, auth } from "../firebaseConfig"
import { collection, addDoc, serverTimestamp } from "firebase/firestore"
import * as Pedometer from "expo-sensors"
import { generateRoute } from "../utils/routeGenerator"
import { LinearGradient } from "expo-linear-gradient"

const { width, height } = Dimensions.get("window")
const isAndroid = Platform.OS === "android"
const isSmallDevice = width < 375

const DEFAULT_STRIDE_LENGTHS = {
  walking: 0.75,
  jogging: 0.9,
  running: 1.1,
  cycling: 0,
}

// Step estimation constants
const STEP_CADENCE_ADJUSTMENT = {
  walking: 1.0,
  jogging: 1.2,
  running: 1.35,
}

// Add these constants near the top of the file, after the other constants
const MINIMUM_DISTANCE_THRESHOLDS = {
  walking: 1.5, // 1.5 meters minimum for walking
  jogging: 2.0, // 2.0 meters minimum for jogging
  running: 2.5, // 2.5 meters minimum for running
  cycling: 3.0, // 3.0 meters minimum for cycling
}

// Add constants for pace smoothing
const PACE_WINDOW_SIZES = {
  walking: 5, // Last 5 pace values for walking
  jogging: 5, // Last 5 pace values for jogging
  running: 5, // Last 5 pace values for running
  cycling: 7, // Last 7 pace values for cycling (more smoothing for cycling)
}

const MapScreen = ({ navigateToActivity, navigateToDashboard, params = {} }) => {
  const {
    activityType = "walking",
    activityColor = "#4361EE",
    targetDistance = "0",
    targetTime = "0",
    tracking: initialTracking = false,
    initialCoordinates = [],
    initialStats = { distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0 },
    activeQuest = null,
    userHeight = 170,
    userStrideLength = null,
  } = params

  const [coordinates, setCoordinates] = useState(initialCoordinates)
  const [currentLocation, setCurrentLocation] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tracking, setTracking] = useState(initialTracking)
  const [isTrackingLoading, setIsTrackingLoading] = useState(false)
  const [stats, setStats] = useState(initialStats)
  const [watchId, setWatchId] = useState(null)
  const [gpsSignal, setGpsSignal] = useState("Unknown")
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false)
  const [pedometerAvailable, setPedometerAvailable] = useState(false)
  const [usingEstimatedSteps, setUsingEstimatedSteps] = useState(false)
  const [strideLength, setStrideLength] = useState(userStrideLength || DEFAULT_STRIDE_LENGTHS[activityType])

  // Add this to the component's state variables
  const [distanceThreshold, setDistanceThreshold] = useState(MINIMUM_DISTANCE_THRESHOLDS[activityType] || 1.5)

  // Add state for smoothed pace
  const [smoothedPace, setSmoothedPace] = useState(0)

  // Add a ref to store recent pace values for the moving average
  const recentPacesRef = useRef([])

  // Add a ref for the pace window size based on activity type
  const paceWindowSizeRef = useRef(PACE_WINDOW_SIZES[activityType] || 5)

  // GPS Signal Indicator position state
  const [gpsIndicatorPosition, setGpsIndicatorPosition] = useState({
    x: width - 100, // Initial position from right
    y: 16, // Initial position from top
  })
  const pan = useRef(new Animated.ValueXY({ x: width - 100, y: 16 })).current

  // Route generation states
  const [suggestedRoute, setSuggestedRoute] = useState(null)
  const [showSuggestedRoute, setShowSuggestedRoute] = useState(false)
  const [isGeneratingRoute, setIsGeneratingRoute] = useState(false)
  const [followingSuggestedRoute, setFollowingSuggestedRoute] = useState(false)

  const [modalVisible, setModalVisible] = useState(false)
  const [modalContent, setModalContent] = useState({ title: "", message: "", onConfirm: null })

  // Animation refs
  const buttonScaleAnim = useRef(new Animated.Value(1)).current
  const iconPulseAnim = useRef(new Animated.Value(1)).current
  const iconMoveAnim = useRef(new Animated.Value(0)).current
  const spinAnim = useRef(new Animated.Value(0)).current
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(50)).current
  const statsSlideAnim = useRef(new Animated.Value(100)).current
  const headerSlideAnim = useRef(new Animated.Value(-50)).current

  const mapRef = useRef(null)
  const intervalRef = useRef(null)
  const startTimeRef = useRef(null)
  const lastUpdateTimeRef = useRef(Date.now())
  const lowAccuracyCountRef = useRef(0)
  const pedometerIntervalRef = useRef(null)
  const rawCoordinatesRef = useRef([])
  const locationWatchRef = useRef(null)
  const lastStepEstimationRef = useRef({ distance: 0, steps: 0 })
  const lastCoordinateForStepsRef = useRef(null)
  const terrainFactorRef = useRef(1.0)

  // Add a ref to store the last coordinate for distance calculations
  const lastCoordinateRef = useRef(null)

  // Create pan responder for draggable GPS indicator
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: pan.x._value,
          y: pan.y._value,
        })
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset()

        // Update the position state for persistence
        setGpsIndicatorPosition({
          x: pan.x._value,
          y: pan.y._value,
        })
      },
    }),
  ).current

  const locationAccuracy =
    activityType === "running" || activityType === "jogging"
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.High
  const locationDistanceInterval = 5
  const locationTimeInterval = activityType === "cycling" ? 1000 : 500

  const activityConfigs = {
    walking: { icon: "walk", color: "#4361EE", strokeColor: "#4361EE", darkColor: "#3651D4" },
    running: { icon: "running", color: "#EF476F", strokeColor: "#EF476F", darkColor: "#D43E63" },
    cycling: { icon: "bicycle", color: "#06D6A0", strokeColor: "#06D6A0", darkColor: "#05C090" },
    jogging: { icon: "running", color: "#FFD166", strokeColor: "#FFD166", darkColor: "#E6BC5C" },
  }

  const currentActivity = activityConfigs[activityType] || activityConfigs.walking
  const maxSpeed = activityType === "cycling" ? 20 : 8

  // Add a function to calculate the moving average for pace
  const calculateMovingAveragePace = (newPace) => {
    // Don't add invalid pace values to the moving average
    if (isNaN(newPace) || newPace === 0 || !isFinite(newPace)) {
      // If we have no valid paces yet, return 0
      if (recentPacesRef.current.length === 0) {
        return 0
      }
      // Otherwise, return the current average without adding the new value
      const sum = recentPacesRef.current.reduce((acc, val) => acc + val, 0)
      return sum / recentPacesRef.current.length
    }

    // Add the new pace to our array of recent paces
    recentPacesRef.current.push(newPace)

    // Keep only the most recent N values based on activity type
    if (recentPacesRef.current.length > paceWindowSizeRef.current) {
      recentPacesRef.current.shift() // Remove the oldest value
    }

    // Calculate the average of recent paces
    const sum = recentPacesRef.current.reduce((acc, val) => acc + val, 0)
    return sum / recentPacesRef.current.length
  }

  // Set initial position for the pan animation
  useEffect(() => {
    pan.setValue({ x: gpsIndicatorPosition.x, y: gpsIndicatorPosition.y })
  }, [])

  // Calculate stride length based on height if not provided
  useEffect(() => {
    if (!userStrideLength) {
      const heightInMeters = userHeight / 100
      let calculatedStride = 0
      switch (activityType) {
        case "walking":
          calculatedStride = heightInMeters * 0.415
          break
        case "jogging":
          calculatedStride = heightInMeters * 0.45
          break
        case "running":
          calculatedStride = heightInMeters * 0.5
          break
        default:
          calculatedStride = DEFAULT_STRIDE_LENGTHS[activityType]
      }
      setStrideLength(calculatedStride || DEFAULT_STRIDE_LENGTHS[activityType])

      // Set the appropriate distance threshold based on activity type
      setDistanceThreshold(MINIMUM_DISTANCE_THRESHOLDS[activityType] || 1.5)

      // Set the appropriate pace window size based on activity type
      paceWindowSizeRef.current = PACE_WINDOW_SIZES[activityType] || 5
    } else {
      setStrideLength(userStrideLength)
    }

    // Reset the pace history when activity type changes
    recentPacesRef.current = []
    setSmoothedPace(0)
  }, [activityType, userHeight, userStrideLength])

  // Check pedometer support
  useEffect(() => {
    const checkPedometerAvailability = async () => {
      try {
        const { status } = await Pedometer.getPermissionsAsync()
        if (status !== "granted") {
          console.log("Pedometer permission denied")
          setPedometerAvailable(false)
          setUsingEstimatedSteps(true)
          return
        }
        try {
          await Pedometer.getStepCountAsync(new Date(0), new Date())
          setPedometerAvailable(true)
          setUsingEstimatedSteps(false)
        } catch (e) {
          console.log("Pedometer not supported:", e)
          setPedometerAvailable(false)
          setUsingEstimatedSteps(true)
        }
      } catch (e) {
        console.log("Pedometer not supported or error:", e)
        setPedometerAvailable(false)
        setUsingEstimatedSteps(true)
      }
    }
    checkPedometerAvailability()
  }, [])

  // Function to generate a suggested route
  const handleGenerateRoute = async () => {
    if (!currentLocation) {
      showModal("Error", "Cannot generate route. Current location not available.")
      return
    }

    setIsGeneratingRoute(true)
    try {
      const route = await generateRoute(
        { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
        Number.parseFloat(targetDistance),
        activityType,
      )

      if (route) {
        setSuggestedRoute(route)
        setShowSuggestedRoute(true)

        // Fit map to show the entire route
        if (mapRef.current && route.coordinates.length > 0) {
          mapRef.current.fitToCoordinates(route.coordinates, {
            edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
            animated: true,
          })
        }

        showModal(
          "Route Generated",
          `A ${route.difficulty} ${route.distance} km ${route.routeType || ""} route has been created for ${activityType}. Would you like to follow this route?`,
          () => {
            setFollowingSuggestedRoute(true)
          },
        )
      } else {
        showModal("Error", "Failed to generate route. Please try again.")
      }
    } catch (error) {
      console.error("Route generation error:", error)
      showModal("Error", "Failed to generate route. Please try again.")
    } finally {
      setIsGeneratingRoute(false)
    }
  }

  // Function to clear the suggested route
  const clearSuggestedRoute = () => {
    setSuggestedRoute(null)
    setShowSuggestedRoute(false)
    setFollowingSuggestedRoute(false)

    // Center map back on current location
    if (mapRef.current && currentLocation) {
      mapRef.current.animateToRegion(
        {
          ...currentLocation,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        1000,
      )
    }
  }

  // Function to estimate steps from GPS data
  const estimateStepsFromGPS = (newCoordinate, prevCoordinate, currentStats) => {
    if (activityType === "cycling" || !prevCoordinate) return currentStats.steps || 0

    const segmentDistance = calculateDistance(
      prevCoordinate.latitude,
      prevCoordinate.longitude,
      newCoordinate.latitude,
      newCoordinate.longitude,
    )

    if (segmentDistance < 1) return currentStats.steps || 0

    let elevationFactor = 1.0
    if (newCoordinate.altitude && prevCoordinate.altitude) {
      const elevationChange = Math.abs(newCoordinate.altitude - prevCoordinate.altitude)
      if (elevationChange > 5) {
        elevationFactor = 1.0 + elevationChange / 100
      }
    }

    const timeDiff = (newCoordinate.timestamp - prevCoordinate.timestamp) / 1000
    const speed = timeDiff > 0 ? segmentDistance / timeDiff : 0
    let adjustedStrideLength = strideLength
    if (speed > 0) {
      const speedFactor = Math.min(speed / 1.5, 1.3)
      adjustedStrideLength = strideLength * speedFactor
    }

    const cadenceAdjustment = STEP_CADENCE_ADJUSTMENT[activityType] || 1.0
    const segmentSteps = Math.round((segmentDistance / adjustedStrideLength) * elevationFactor * cadenceAdjustment)

    return (currentStats.steps || 0) + segmentSteps
  }

  const animateButtonPress = () => {
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start()
  }

  const startIconPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulseAnim, {
          toValue: 1.2,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconPulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start()
  }

  const startIconMoveAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconMoveAnim, {
          toValue: 5,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconMoveAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start()
  }

  const startSpinAnimation = () => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start()
  }

  const animateScreenElements = () => {
    // Reset animation values
    fadeAnim.setValue(0)
    slideAnim.setValue(50)
    statsSlideAnim.setValue(100)
    headerSlideAnim.setValue(-50)

    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(statsSlideAnim, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(headerSlideAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }

  const animateTrackingTransition = (isStarting) => {
    // Animate stats panel sliding in/out
    Animated.timing(statsSlideAnim, {
      toValue: isStarting ? 0 : 100,
      duration: 300,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!isStarting) {
        // If stopping, slide back in with updated stats
        Animated.timing(statsSlideAnim, {
          toValue: 0,
          duration: 300,
          delay: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start()
      }
    })
  }

  const stopAnimations = () => {
    iconPulseAnim.stopAnimation()
    iconMoveAnim.stopAnimation()
    spinAnim.stopAnimation()
    iconPulseAnim.setValue(1)
    iconMoveAnim.setValue(0)
    spinAnim.setValue(0)
  }

  useEffect(() => {
    if (tracking) {
      startIconPulseAnimation()
      animateTrackingTransition(true)
    } else if (!isTrackingLoading) {
      startIconMoveAnimation()
      if (coordinates.length > 0) {
        animateTrackingTransition(false)
      }
    }
    if (isTrackingLoading) {
      startSpinAnimation()
    }
    return () => {
      stopAnimations()
    }
  }, [tracking, isTrackingLoading])

  // Initial animations when screen loads
  useEffect(() => {
    if (!loading) {
      animateScreenElements()
    }
  }, [loading])

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  })

  const returnToActivity = () => {
    navigateToActivity()
  }

  const centerMap = () => {
    if (mapRef.current && currentLocation) {
      mapRef.current.animateToRegion(
        {
          ...currentLocation,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        1000,
      )
    }
  }

  const showModal = (title, message, onConfirm = null) => {
    setModalContent({ title, message, onConfirm })
    setModalVisible(true)
  }

  // Replace the calculateMetrics function with this improved version
  const calculateMetrics = (distance, duration) => {
    // Ensure we're working with numbers
    const numDistance = Number(distance)
    const numDuration = Number(duration)

    // Prevent division by zero and handle invalid inputs
    // Only calculate pace if we have meaningful distance and duration
    if (numDistance < 5 || numDuration < 5 || isNaN(numDistance) || isNaN(numDuration)) {
      return { pace: 0, avgSpeed: 0 }
    }

    // Calculate pace in minutes per kilometer
    const rawPace = calculatePace(numDistance, numDuration)

    // Calculate the smoothed pace using the moving average
    const smoothedPaceValue = calculateMovingAveragePace(rawPace)

    // Update the smoothed pace state
    setSmoothedPace(smoothedPaceValue)

    // Calculate average speed in km/h
    const avgSpeed = numDistance / 1000 / (numDuration / 3600)

    return { pace: smoothedPaceValue, rawPace, avgSpeed }
  }

  const backAction = () => {
    if (tracking) {
      showModal("Stop Tracking", "Are you sure you want to stop tracking and exit?", () => {
        stopTracking()
        navigateToActivity()
      })
      return true
    }
    return false
  }

  useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction)
    return () => backHandler.remove()
  }, [tracking])

  // Initialize location tracking
  useEffect(() => {
    const initialize = async () => {
      try {
        const hasPermission = await requestPermissions()
        if (!hasPermission) {
          setError("Location permissions are required to use this feature.")
          setLoading(false)
          return
        }
        await startLocationUpdates()
        if (initialTracking) {
          await startTracking()
        } else {
          showModal(
            "Optimize GPS Accuracy",
            "For best results, keep your phone in an open position (e.g., armband, bike mount) and avoid pockets or bags.",
          )
        }
      } catch (err) {
        console.error("Initialization error:", err)
        setError("Failed to initialize. Please check your location settings.")
        setLoading(false)
      }
    }

    initialize()

    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === "background" && tracking) {
        if (isAndroid) {
          showModal("Background Tracking", "Tracking may be less accurate in the background.")
        }
      } else if (nextAppState === "active") {
        if (!tracking && locationPermissionGranted && !locationWatchRef.current) {
          startLocationUpdates()
        }
      }
    }

    const subscription = AppState.addEventListener("change", handleAppStateChange)

    return () => {
      subscription?.remove()
      if (locationWatchRef.current) locationWatchRef.current.remove()
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (pedometerIntervalRef.current) clearInterval(pedometerIntervalRef.current)
    }
  }, [])

  const startLocationUpdates = async () => {
    try {
      if (locationWatchRef.current) {
        locationWatchRef.current.remove()
        locationWatchRef.current = null
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: locationAccuracy,
        timeout: 10000,
      })
      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }
      setCurrentLocation(newRegion)
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000)
      }
      const watchId = await Location.watchPositionAsync(
        {
          accuracy: locationAccuracy,
          distanceInterval: locationDistanceInterval,
          timeInterval: locationTimeInterval,
        },
        (location) => {
          const { latitude, longitude, accuracy, speed } = location.coords
          if (accuracy > 50) {
            setGpsSignal("Poor")
          } else if (accuracy > 30) {
            setGpsSignal("Fair")
          } else if (accuracy > 15) {
            setGpsSignal("Good")
          } else {
            setGpsSignal("Excellent")
          }

          const newRegion = {
            latitude,
            longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }
          setCurrentLocation(newRegion)
        },
      )
      locationWatchRef.current = watchId
      setLoading(false)
    } catch (err) {
      console.error("Location updates error:", err)
      setError("Failed to get location updates. Please check your GPS settings.")
      setLoading(false)
    }
  }

  const requestPermissions = async () => {
    try {
      const enabled = await Location.hasServicesEnabledAsync()
      if (!enabled) {
        showModal("Location Services Disabled", "Please enable location services to use this feature", () =>
          Location.enableNetworkProviderAsync(),
        )
        return false
      }
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") {
        showModal("Permission Denied", "This app requires location access to track your activity.")
        return false
      }
      setLocationPermissionGranted(true)
      if (isAndroid) {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync()
        if (backgroundStatus !== "granted") {
          showModal(
            "Background Permission",
            "For continuous tracking, please enable background location in app settings.",
          )
        }
      }
      return true
    } catch (err) {
      console.error("Permission error:", err)
      showModal("Error", "Failed to request permissions.")
      return false
    }
  }

  const getCurrentLocation = async () => {
    try {
      const hasPermission = await requestPermissions()
      if (!hasPermission) return
      const location = await Location.getCurrentPositionAsync({
        accuracy: locationAccuracy,
        timeout: 10000,
      })
      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }
      setCurrentLocation(newRegion)
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000)
      }
      return location
    } catch (err) {
      console.error(err)
      setError("Failed to get location. Ensure GPS is enabled.")
      throw err
    }
  }

  // Update the startTracking function to properly initialize stats
  const startTracking = async () => {
    animateButtonPress()
    setIsTrackingLoading(true)
    try {
      const hasPermission = await requestPermissions()
      if (!hasPermission) {
        setError("Location permissions not granted.")
        setIsTrackingLoading(false)
        return
      }
      if (locationWatchRef.current) {
        locationWatchRef.current.remove()
        locationWatchRef.current = null
      }
      let initialLocation
      if (currentLocation) {
        initialLocation = {
          coords: {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            accuracy: 10,
          },
          timestamp: Date.now(),
        }
      } else {
        initialLocation = await getCurrentLocation()
        if (!initialLocation) {
          setError("Failed to get initial location.")
          setIsTrackingLoading(false)
          return
        }
      }

      // Create the initial coordinate
      const initialCoord = {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude,
        timestamp: initialLocation.timestamp,
        accuracy: initialLocation.coords.accuracy,
      }

      // Store the initial coordinate in the ref for future distance calculations
      lastCoordinateRef.current = initialCoord

      // Always start with just the initial location point for new activities
      setCoordinates([initialCoord])

      lastCoordinateForStepsRef.current = {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude,
        timestamp: initialLocation.timestamp,
        altitude: initialLocation.coords.altitude,
      }
      lastStepEstimationRef.current = { distance: 0, steps: 0 }

      startTimeRef.current = new Date()
      lastUpdateTimeRef.current = Date.now()
      lowAccuracyCountRef.current = 0
      rawCoordinatesRef.current = []

      // Reset the pace history when starting a new activity
      recentPacesRef.current = []
      setSmoothedPace(0)

      setTracking(true)
      setFollowingSuggestedRoute(followingSuggestedRoute) // Retain state

      // Reset stats when starting a new tracking session
      // Ensure all values are proper numbers
      setStats({
        distance: 0,
        duration: 0,
        pace: 0,
        rawPace: 0,
        avgSpeed: 0,
        steps: 0,
      })

      // Debug log
      console.log("Starting tracking with reset stats")
      console.log("Initial coordinate set:", initialCoord)
      console.log(`Pace window size: ${paceWindowSizeRef.current} for ${activityType}`)

      intervalRef.current = setInterval(() => {
        setStats((prev) => {
          const duration = Math.floor((new Date() - startTimeRef.current) / 1000)
          const metrics = calculateMetrics(prev.distance, duration)
          return { ...prev, duration, ...metrics }
        })
      }, 1000)

      if (
        (activityType === "walking" || activityType === "jogging" || activityType === "running") &&
        pedometerAvailable
      ) {
        pedometerIntervalRef.current = setInterval(async () => {
          try {
            const result = await Pedometer.getStepCountAsync(new Date(0), new Date())
            setStats((prev) => ({ ...prev, steps: result.steps }))
          } catch (e) {
            console.log("Error fetching step count:", e)
            if (!usingEstimatedSteps) {
              setUsingEstimatedSteps(true)
              setPedometerAvailable(false)
              console.log("Switching to estimated steps due to pedometer failure")
            }
          }
        }, 5000)
      } else if (activityType !== "cycling") {
        setUsingEstimatedSteps(true)
      }

      // Find the location update handler in the startTracking function and replace it with this improved version:

      const id = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (location) => {
          const { latitude, longitude, accuracy, speed, altitude } = location.coords

          // Log location updates for debugging
          console.log(
            `Location update: lat=${latitude.toFixed(6)}, lng=${longitude.toFixed(6)}, acc=${accuracy.toFixed(1)}m`,
          )

          if (accuracy > 50 || speed > maxSpeed) {
            lowAccuracyCountRef.current += 1
            if (lowAccuracyCountRef.current >= 5) {
              setGpsSignal("Poor")
            }
            return
          }

          lowAccuracyCountRef.current = 0
          if (accuracy > 30) {
            setGpsSignal("Fair")
          } else if (accuracy > 15) {
            setGpsSignal("Good")
          } else {
            setGpsSignal("Excellent")
          }

          const newCoordinate = {
            latitude,
            longitude,
            accuracy,
            timestamp: location.timestamp,
            altitude,
          }

          rawCoordinatesRef.current.push(newCoordinate)
          if (rawCoordinatesRef.current.length > 5) rawCoordinatesRef.current.shift()

          const smoothedCoordinate = smoothCoordinate(rawCoordinatesRef.current, newCoordinate)

          const newRegion = {
            latitude,
            longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }

          setCurrentLocation(newRegion)

          // Get the previous coordinate from our ref
          const lastCoord = lastCoordinateRef.current

          // If we have a previous coordinate, calculate distance
          if (lastCoord) {
            // Calculate distance increment between last point and new point
            const distanceIncrement = calculateDistance(
              lastCoord.latitude,
              lastCoord.longitude,
              smoothedCoordinate.latitude,
              smoothedCoordinate.longitude,
            )

            // Log the raw distance increment for debugging
            console.log(`Raw distance increment: ${distanceIncrement.toFixed(2)}m from previous point`)

            // Apply distance threshold to filter out GPS jitter
            const filteredIncrement = distanceIncrement >= distanceThreshold ? distanceIncrement : 0

            if (filteredIncrement === 0 && distanceIncrement > 0) {
              console.log(
                `Filtered out small movement (${distanceIncrement.toFixed(2)}m < ${distanceThreshold}m threshold)`,
              )
            }

            // Update stats with new distance and pace
            setStats((prevStats) => {
              // Ensure we're working with numbers
              const newDistance = Number(prevStats.distance) + Number(filteredIncrement)
              const duration = Math.floor((new Date() - startTimeRef.current) / 1000)

              // Calculate metrics based on new distance and duration
              const metrics = calculateMetrics(newDistance, duration)

              if (filteredIncrement > 0) {
                console.log(
                  `Updated stats: distance=${newDistance.toFixed(2)}m, duration=${duration}s, raw pace=${metrics.rawPace?.toFixed(2)}, smoothed pace=${metrics.pace?.toFixed(2)}`,
                )
              }

              let updatedSteps = prevStats.steps
              if (usingEstimatedSteps && activityType !== "cycling") {
                // Only estimate steps for movements that exceed the threshold
                if (filteredIncrement > 0) {
                  updatedSteps = estimateStepsFromGPS(
                    { ...smoothedCoordinate, timestamp: location.timestamp, altitude },
                    lastCoordinateForStepsRef.current,
                    prevStats,
                  )
                  lastCoordinateForStepsRef.current = {
                    latitude: smoothedCoordinate.latitude,
                    longitude: smoothedCoordinate.longitude,
                    timestamp: location.timestamp,
                    altitude,
                  }
                }
              }

              return {
                ...prevStats,
                distance: newDistance,
                duration,
                ...metrics,
                steps: updatedSteps,
              }
            })
          } else {
            console.log("No previous coordinate available for distance calculation")
          }

          // Update the coordinates array with the new point
          setCoordinates((prev) => [...prev, smoothedCoordinate])

          // Update our ref with the current coordinate for next calculation
          lastCoordinateRef.current = smoothedCoordinate
        },
      )
      setWatchId(id)
    } catch (err) {
      console.error("Start tracking error:", err)
      setError("Failed to start tracking.")
      stopTracking()
    } finally {
      setIsTrackingLoading(false)
    }
  }

  const smoothCoordinate = (previousCoordinates, newCoordinate) => {
    if (previousCoordinates.length < 2) return newCoordinate
    let totalWeight = 0
    let weightedLat = 0
    let weightedLng = 0
    previousCoordinates.forEach((coord, index) => {
      const weight = (index + 1) / (coord.accuracy || 20)
      totalWeight += weight
      weightedLat += coord.latitude * weight
      weightedLng += coord.longitude * weight
    })
    const currentWeight = previousCoordinates.length / (newCoordinate.accuracy || 20)
    totalWeight += currentWeight
    weightedLat += newCoordinate.latitude * currentWeight
    weightedLng += newCoordinate.longitude * currentWeight
    return {
      ...newCoordinate,
      latitude: weightedLat / totalWeight,
      longitude: weightedLng / totalWeight,
    }
  }

  const stopTracking = async () => {
    animateButtonPress()
    setIsTrackingLoading(true)
    try {
      if (watchId && typeof watchId.remove === "function") {
        watchId.remove()
        setWatchId(null)
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (pedometerIntervalRef.current) {
        clearInterval(pedometerIntervalRef.current)
        pedometerIntervalRef.current = null
      }
      setTracking(false)
      setFollowingSuggestedRoute(false)
      await startLocationUpdates()
    } catch (err) {
      console.error("Stop tracking error:", err)
      setError("Failed to stop tracking.")
    } finally {
      setIsTrackingLoading(false)
    }
  }

  const saveActivity = async () => {
    setIsTrackingLoading(true)
    try {
      const user = auth.currentUser
      if (!user) {
        showModal("Error", "You must be logged in to save activities.")
        setIsTrackingLoading(false)
        return
      }

      // Add validation to prevent saving activities with minimal distance/duration
      if (stats.distance < 10) {
        // Less than 10 meters
        showModal(
          "Activity Too Short",
          "Your activity was too short to save. Please track a longer distance.",
          navigateToActivity,
        )
        setIsTrackingLoading(false)
        return
      }

      const activityData = {
        userId: user.uid,
        activityType,
        distance: stats.distance / 1000,
        duration: stats.duration,
        pace: stats.pace,
        avgSpeed: stats.avgSpeed,
        steps: stats.steps,
        stepsEstimated: usingEstimatedSteps,
        coordinates: coordinates.map((coord) => ({
          latitude: coord.latitude,
          longitude: coord.longitude,
          timestamp: coord.timestamp,
        })),
        targetDistance: Number.parseFloat(targetDistance),
        targetTime: Number.parseInt(targetTime),
        createdAt: serverTimestamp(),
        followedSuggestedRoute: followingSuggestedRoute,
      }

      if (activeQuest) {
        activityData.questId = activeQuest.id
        activityData.questTitle = activeQuest.title
      }

      await addDoc(collection(db, "activities"), activityData)

      let questCompleted = false
      if (activeQuest) {
        const questProgress =
          activeQuest.unit === "steps" ? stats.steps / activeQuest.goal : stats.distance / 1000 / activeQuest.goal
        questCompleted = questProgress >= 1
      }

      showModal(
        questCompleted ? "Quest Completed!" : "Activity Saved",
        questCompleted
          ? `Congratulations! You completed the "${activeQuest.title}" quest with ${(stats.distance / 1000).toFixed(2)} km of ${activityType}${stats.steps ? ` and ${stats.steps} steps` : ""}.`
          : `You completed ${(stats.distance / 1000).toFixed(2)} km of ${activityType}${stats.steps ? ` with ${stats.steps} steps` : ""}.`,
        navigateToActivity,
      )
    } catch (error) {
      console.error("Error saving activity:", error)
      showModal("Error", "Failed to save activity. Please try again.")
    } finally {
      setIsTrackingLoading(false)
    }
  }

  // Render loading state
  if (loading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size={isSmallDevice ? "small" : "large"} color={currentActivity.color} />
        <CustomText style={twrnc`text-white mt-4 ${isSmallDevice ? "text-sm" : "text-base"}`}>
          Initializing GPS...
        </CustomText>
      </View>
    )
  }

  // Render error state
  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center p-4`}>
        <FontAwesome name="exclamation-circle" size={48} color="#EF4444" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-white text-center mb-4 ${isSmallDevice ? "text-sm" : "text-base"}`}>
          {error}
        </CustomText>
        <TouchableOpacity
          style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg ${isAndroid ? "active:opacity-70" : ""}`}
          activeOpacity={0.7}
          onPress={() => {
            setError(null)
            startLocationUpdates()
          }}
        >
          <CustomText style={twrnc`text-white ${isSmallDevice ? "text-sm" : "text-base"}`}>Try Again</CustomText>
        </TouchableOpacity>
      </View>
    )
  }

  // Main component render
  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      {/* Modal */}
      <CustomModal
        visible={modalVisible}
        title={modalContent.title}
        message={modalContent.message}
        onConfirm={() => {
          modalContent.onConfirm?.()
          setModalVisible(false)
        }}
        onCancel={() => setModalVisible(false)}
      />

      {/* Header */}
      <Animated.View style={[twrnc`z-10`, { transform: [{ translateY: headerSlideAnim }], opacity: fadeAnim }]}>
        <LinearGradient
          colors={[currentActivity.color, currentActivity.darkColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={twrnc`flex-row items-center justify-between p-4 rounded-b-2xl`}
        >
          <TouchableOpacity
            onPress={returnToActivity}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            disabled={isTrackingLoading}
            style={twrnc`p-2`}
          >
            <Icon name="angle-left" size={isSmallDevice ? 24 : 28} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={twrnc`flex-row items-center`}>
            {activeQuest && (
              <View style={twrnc`bg-white bg-opacity-20 rounded-full p-1 mr-2`}>
                <FontAwesome name="trophy" size={isSmallDevice ? 14 : 16} color="#FFD166" />
              </View>
            )}
            <CustomText weight="semibold" style={twrnc`text-white ${isSmallDevice ? "text-lg" : "text-xl"}`}>
              {activeQuest ? activeQuest.title : activityType.charAt(0).toUpperCase() + activityType.slice(1)}
            </CustomText>
          </View>

          <TouchableOpacity
            onPress={centerMap}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            disabled={isTrackingLoading}
            style={twrnc`p-2`}
          >
            <FontAwesome name="compass" size={isSmallDevice ? 20 : 24} color="#fff" />
          </TouchableOpacity>
        </LinearGradient>
      </Animated.View>

      {/* Map View */}
      <MapView
        ref={mapRef}
        style={twrnc`flex-1`}
        provider={PROVIDER_GOOGLE}
        initialRegion={currentLocation}
        showsUserLocation={true}
        showsMyLocationButton={false}
        followsUserLocation={tracking}
        loadingEnabled={true}
        moveOnMarkerPress={false}
        toolbarEnabled={false}
        mapType="standard"
        customMapStyle={[
          {
            featureType: "road",
            elementType: "geometry",
            stylers: [{ color: "#808080" }],
          },
          {
            featureType: "road",
            elementType: "labels.text.fill",
            stylers: [{ color: "#FFFFFF" }],
          },
          {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#0e1626" }],
          },
        ]}
      >
        {/* Current position marker when not tracking */}
        {!tracking && currentLocation && (
          <Marker
            coordinate={{
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude,
            }}
          >
            <View style={twrnc`items-center`}>
              <View
                style={twrnc`bg-[${currentActivity.color}] p-2 rounded-full border-2 border-white items-center justify-center`}
              >
                <Ionicons name={currentActivity.icon} size={16} color="white" />
              </View>
              <View
                style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
              />
            </View>
          </Marker>
        )}

        {/* Suggested route polyline */}
        {showSuggestedRoute && suggestedRoute && (
          <>
            {/* Glow effect for Strava-like polish */}
            <Polyline
              coordinates={suggestedRoute.coordinates}
              strokeColor={followingSuggestedRoute ? currentActivity.strokeColor : "#3B82F6"}
              strokeWidth={followingSuggestedRoute ? 10 : 8}
              lineDashPattern={null}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
              style={{ opacity: 0.3 }} // Semi-transparent glow
            />
            {/* Main polyline */}
            <Polyline
              coordinates={suggestedRoute.coordinates}
              strokeColor={followingSuggestedRoute ? currentActivity.strokeColor : "#3B82F6"}
              strokeWidth={followingSuggestedRoute ? 6 : 4}
              lineDashPattern={null}
              lineCap="round"
              lineJoin="round"
              geodesic={true}
              tappable={true}
              onPress={() => {
                showModal(
                  "Suggested Route",
                  `Follow this ${suggestedRoute.distance} km ${suggestedRoute.routeType} route?`,
                  () => {
                    setFollowingSuggestedRoute(true)
                  },
                )
              }}
            />

            {/* Waypoint markers */}
            {suggestedRoute.waypoints.map((waypoint, index) => (
              <Marker
                key={`waypoint-${index}`}
                coordinate={{
                  latitude: waypoint.latitude,
                  longitude: waypoint.longitude,
                }}
                title={waypoint.name}
                description={waypoint.type}
              >
                <View style={twrnc`items-center`}>
                  <View
                    style={twrnc`p-2 rounded-full border-2 border-white ${
                      waypoint.type === "start"
                        ? "bg-green-500"
                        : waypoint.type === "end"
                          ? "bg-red-500"
                          : "bg-blue-500"
                    }`}
                  >
                    <FontAwesome
                      name={waypoint.type === "start" ? "play" : waypoint.type === "end" ? "stop" : "map-marker"}
                      size={16}
                      color="white"
                    />
                  </View>
                  <View
                    style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
                  />
                </View>
              </Marker>
            ))}
          </>
        )}

        {/* Actual tracking path */}
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
            {coordinates.length > 1 && !followingSuggestedRoute && (
              <>
                <Marker coordinate={coordinates[0]}>
                  <View style={twrnc`items-center`}>
                    <View style={twrnc`bg-green-500 p-2 rounded-full border-2 border-white`}>
                      <FontAwesome name="flag" size={16} color="white" />
                    </View>
                    <View
                      style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
                    />
                  </View>
                </Marker>
                <Marker coordinate={coordinates[coordinates.length - 1]}>
                  <View style={twrnc`items-center`}>
                    <View style={twrnc`bg-red-500 p-2 rounded-full border-2 border-white`}>
                      <FontAwesome name="flag" size={16} color="white" />
                    </View>
                    <View
                      style={twrnc`w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white -mt-0.5`}
                    />
                  </View>
                </Marker>
              </>
            )}
          </>
        )}
      </MapView>

      {/* Route generation button */}
      {!tracking && !showSuggestedRoute && (
        <Animated.View
          style={{
            position: "absolute",
            top: 80,
            right: 16,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            zIndex: 10,
          }}
        >
          <TouchableOpacity
            style={twrnc`shadow-lg ${isAndroid ? "elevation-5" : ""}`}
            onPress={handleGenerateRoute}
            disabled={isGeneratingRoute || !currentLocation}
          >
            <LinearGradient
              colors={[currentActivity.color, currentActivity.darkColor]}
              style={twrnc`w-12 h-12 rounded-full items-center justify-center border-2 border-white`}
            >
              {isGeneratingRoute ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <FontAwesome name="map" size={20} color="white" />
              )}
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Route info panel */}
      {showSuggestedRoute && suggestedRoute && !tracking && (
        <Animated.View
          style={{
            position: "absolute",
            top: 80,
            left: 16,
            right: 16,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            zIndex: 10,
          }}
        >
          <LinearGradient
            colors={["#2A2E3A", "#1E2538"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={twrnc`p-3 rounded-xl shadow-lg ${isAndroid ? "elevation-5" : ""}`}
          >
            <View style={twrnc`flex-row items-center justify-between`}>
              <View style={twrnc`flex-1`}>
                <CustomText style={twrnc`text-white text-sm font-medium`}>{suggestedRoute.name}</CustomText>
                <View style={twrnc`flex-row items-center mt-1`}>
                  <FontAwesome name="map-o" size={14} color="#9CA3AF" style={twrnc`mr-2`} />
                  <CustomText style={twrnc`text-gray-400 text-xs`}>
                    {suggestedRoute.distance} km • {suggestedRoute.difficulty} • {suggestedRoute.routeType || "route"}
                  </CustomText>
                </View>
              </View>
              <TouchableOpacity onPress={clearSuggestedRoute} style={twrnc`bg-[#3A3F4B] p-2 rounded-full`}>
                <FontAwesome name="times" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>
      )}

      {/* Quest indicator */}
      {activeQuest && !tracking && (
        <Animated.View
          style={{
            position: "absolute",
            top: showSuggestedRoute ? 150 : 80,
            left: 16,
            right: 16,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            zIndex: 10,
          }}
        >
          <LinearGradient
            colors={["#4361EE", "#3A0CA3"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={twrnc`p-3 rounded-xl shadow-lg ${isAndroid ? "elevation-5" : ""}`}
          >
            <View style={twrnc`flex-row items-center`}>
              <View style={twrnc`bg-white bg-opacity-20 rounded-full p-2 mr-3`}>
                <FontAwesome name="trophy" size={18} color="#FFD166" />
              </View>
              <View style={twrnc`flex-1`}>
                <CustomText style={twrnc`text-white text-sm font-medium`}>Quest: {activeQuest.title}</CustomText>
                <View style={twrnc`flex-row items-center mt-1`}>
                  <View style={twrnc`flex-1 h-1.5 bg-[#3A3F4B] rounded-full mr-2`}>
                    <View
                      style={{
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: "#FFD166",
                        width: `${Math.min(((activeQuest.unit === "steps" ? stats.steps : stats.distance / 1000) / activeQuest.goal) * 100, 100)}%`,
                      }}
                    />
                  </View>
                  <CustomText style={twrnc`text-white text-xs`}>
                    {activeQuest.unit === "steps"
                      ? `${stats.steps || 0}/${activeQuest.goal} steps`
                      : `${(stats.distance / 1000).toFixed(2)}/${activeQuest.goal} km`}
                  </CustomText>
                </View>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>
      )}

      {/* Draggable GPS Signal Indicator */}
      <Animated.View
        style={{
          position: "absolute",
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
          zIndex: 20,
        }}
        {...panResponder.panHandlers}
      >
        <View style={twrnc`flex-row items-center bg-[#2A2E3A] bg-opacity-80 px-2.5 py-1.5 rounded-full shadow-md`}>
          <FontAwesome
            name="signal"
            size={14}
            color={
              gpsSignal === "Excellent"
                ? "#22C55E"
                : gpsSignal === "Good"
                  ? "#3B82F6"
                  : gpsSignal === "Fair"
                    ? "#F59E0B"
                    : "#EF4444"
            }
          />
          <CustomText style={twrnc`text-white ml-2 text-xs font-medium`}>GPS: {gpsSignal}</CustomText>
          <View style={twrnc`ml-1 bg-gray-500 rounded-full h-1 w-1`} />
        </View>
      </Animated.View>

      {/* Stats & Controls */}
      <Animated.View
        style={[
          twrnc`absolute bottom-4 left-4 right-4`,
          { opacity: fadeAnim, transform: [{ translateY: statsSlideAnim }], zIndex: 10 },
        ]}
      >
        <LinearGradient
          colors={["#2A2E3A", "#1E2538"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={twrnc`p-4 rounded-xl shadow-lg ${isAndroid ? "elevation-5" : ""}`}
        >
          {/* Stats */}
          <View style={twrnc`flex-row justify-between mb-4 flex-wrap`}>
            <View style={twrnc`items-center ${isSmallDevice ? "w-1/2 mb-2" : "w-1/4"}`}>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"} mb-1`}>
                Distance
              </CustomText>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                {(stats.distance / 1000).toFixed(2)} km
              </CustomText>
              {targetDistance !== "0" && (
                <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-2xs" : "text-xs"}`}>
                  Target: {targetDistance} km
                </CustomText>
              )}
            </View>
            <View style={twrnc`items-center ${isSmallDevice ? "w-1/2 mb-2" : "w-1/4"}`}>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"} mb-1`}>
                Duration
              </CustomText>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                {formatTime(stats.duration)}
              </CustomText>
              {targetTime !== "0" && (
                <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-2xs" : "text-xs"}`}>
                  Target: {targetTime} min
                </CustomText>
              )}
            </View>
            {/* Update the stats display in the render function to use formatPace */}
            {/* Find the section where pace is displayed and update it: */}
            <View style={twrnc`items-center ${isSmallDevice ? "w-1/2 mb-2" : "w-1/4"}`}>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"} mb-1`}>Pace</CustomText>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                {formatPace(stats.pace)} /km
              </CustomText>
              <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-2xs" : "text-xs"}`}>
                {stats.avgSpeed.toFixed(1)} km/h
              </CustomText>
            </View>
            <View style={twrnc`items-center ${isSmallDevice ? "w-1/2 mb-2" : "w-1/4"}`}>
              <View style={twrnc`flex-row items-center`}>
                <CustomText style={twrnc`text-gray-400 ${isSmallDevice ? "text-xs" : "text-sm"} mb-1`}>
                  {activityType === "walking" || activityType === "jogging" || activityType === "running"
                    ? "Steps"
                    : "GPS Signal"}
                </CustomText>
                {usingEstimatedSteps &&
                  (activityType === "walking" || activityType === "jogging" || activityType === "running") && (
                    <FontAwesome
                      name="calculator"
                      size={isSmallDevice ? 10 : 12}
                      color="#F59E0B"
                      style={twrnc`ml-1 mb-1`}
                    />
                  )}
              </View>
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                {activityType === "walking" || activityType === "jogging" || activityType === "running"
                  ? stats.steps || 0
                  : gpsSignal}
              </CustomText>
              {usingEstimatedSteps &&
                (activityType === "walking" || activityType === "jogging" || activityType === "running") && (
                  <CustomText style={twrnc`text-yellow-400 ${isSmallDevice ? "text-2xs" : "text-xs"}`}>
                    Estimated
                  </CustomText>
                )}
            </View>
          </View>

          {/* Start / Stop Button */}
          <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
            <TouchableOpacity
              style={twrnc`py-3 rounded-lg items-center flex-row justify-center ${tracking ? "bg-[#EF4444]" : `bg-[${currentActivity.color}]`} ${
                isAndroid ? "active:opacity-70" : ""
              } ${isTrackingLoading ? "opacity-50" : ""}`}
              activeOpacity={0.7}
              onPress={() => {
                if (tracking) {
                  stopTracking()
                  saveActivity()
                } else {
                  startTracking()
                }
              }}
              disabled={isTrackingLoading}
            >
              {isTrackingLoading ? (
                <Animated.View style={{ transform: [{ rotate: spin }] }}>
                  <View style={twrnc`h-5 w-5 rounded-full border-2 border-white border-t-transparent mr-2`} />
                </Animated.View>
              ) : tracking ? (
                <Animated.View style={{ transform: [{ scale: iconPulseAnim }] }}>
                  <FontAwesome
                    name="stop"
                    size={isSmallDevice ? 18 : 20}
                    color="white"
                    style={twrnc`${isSmallDevice ? "mr-1" : "mr-2"}`}
                  />
                </Animated.View>
              ) : (
                <Animated.View style={{ transform: [{ translateX: iconMoveAnim }] }}>
                  <FontAwesome
                    name="play"
                    size={isSmallDevice ? 18 : 20}
                    color="white"
                    style={twrnc`${isSmallDevice ? "mr-1" : "mr-2"}`}
                  />
                </Animated.View>
              )}
              <CustomText weight="bold" style={twrnc`text-white ${isSmallDevice ? "text-base" : "text-lg"}`}>
                {isTrackingLoading
                  ? tracking
                    ? "Saving..."
                    : "Starting..."
                  : tracking
                    ? "Stop & Save"
                    : followingSuggestedRoute
                      ? "Start Following Route"
                      : activeQuest
                        ? "Start Quest"
                        : "Start Tracking"}
              </CustomText>
            </TouchableOpacity>
          </Animated.View>
        </LinearGradient>
      </Animated.View>

      {/* Google Maps Attribution */}
      <View style={twrnc`absolute bottom-2 right-2 z-10`}>
        <CustomText style={twrnc`text-gray-400 text-xs`}>Powered by Google Maps</CustomText>
      </View>
    </View>
  )
}

export default MapScreen
