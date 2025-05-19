"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  View,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Dimensions,
  Animated,
  Easing,
  StyleSheet,
  Pressable,
} from "react-native"
import MapView, { Polyline, PROVIDER_GOOGLE } from "react-native-maps"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import { FontAwesome } from "@expo/vector-icons"
import { Feather } from "@expo/vector-icons"
import * as Location from "expo-location"
import { getDocs, collection, query, where } from "firebase/firestore"
import { db, auth } from "../firebaseConfig"
import { formatTime } from "../utils/activityUtils"
import RouteAnimationVideo from "../components/RouteAnimationVideo"

// Helper functions moved outside component for better performance
const formatDate = (date = new Date()) => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]
  const dayName = days[date.getDay()]
  const day = date.getDate()
  const month = months[date.getMonth()]
  return `${dayName}, ${day} ${month}`
}

const calculateMapRegion = (coordinates) => {
  if (!coordinates || coordinates.length === 0) {
    return {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    }
  }
  const latitudes = coordinates.map((coord) => coord.latitude)
  const longitudes = coordinates.map((coord) => coord.longitude)
  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes) // Fixed: was incorrectly using longitudes
  const minLon = Math.min(...longitudes)
  const maxLon = Math.max(...longitudes)
  const latitude = (minLat + maxLat) / 2
  const longitude = (minLon + maxLon) / 2
  const latitudeDelta = (maxLat - minLat) * 1.5 || 0.005
  const longitudeDelta = (maxLon - minLon) * 1.5 || 0.005
  return { latitude, longitude, latitudeDelta, longitudeDelta }
}

const getWeekDates = () => {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - dayOfWeek)
  const weekDates = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    weekDates.push({
      day: date.getDate(),
      isToday: date.toDateString() === today.toDateString(),
      date: date,
    })
  }
  return weekDates
}

// Enhanced function to get month calendar data
const getMonthCalendar = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()

  // Get first day of month and total days in month
  const firstDayOfMonth = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Get day of week for first day (0 = Sunday, 6 = Saturday)
  const firstDayWeekday = firstDayOfMonth.getDay()

  // Create array for calendar grid (6 rows x 7 columns)
  const calendarDays = []

  // Add empty slots for days before the 1st of the month
  for (let i = 0; i < firstDayWeekday; i++) {
    calendarDays.push({ day: null, isCurrentMonth: false, date: null })
  }

  // Add days of the current month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    calendarDays.push({
      day: day,
      isToday: date.toDateString() === today.toDateString(),
      isCurrentMonth: true,
      date: date,
    })
  }

  // Fill remaining slots in the grid (if needed)
  const remainingSlots = 42 - calendarDays.length // 6 rows x 7 columns = 42
  if (remainingSlots > 0 && remainingSlots < 7) {
    for (let i = 1; i <= remainingSlots; i++) {
      calendarDays.push({ day: i, isCurrentMonth: false, date: new Date(year, month + 1, i) })
    }
  }

  return calendarDays
}

// Get month name and year for display
const getMonthYearString = () => {
  const today = new Date()
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]
  return `${months[today.getMonth()]} ${today.getFullYear()}`
}

const DashboardScreen = ({ navigateToActivity, navigation }) => {
  const [activityData, setActivityData] = useState({
    coordinates: [],
    distance: "0 km",
    duration: "0:00",
    steps: 0,
    activityType: "walking",
    stats: { pace: "0:00/km", avgSpeed: "0 km/h" },
  })
  const [userLocation, setUserLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [quests, setQuests] = useState([])
  const [dailyQuest, setDailyQuest] = useState(null)
  const [questLoading, setQuestLoading] = useState(true)
  const [weeklyProgress, setWeeklyProgress] = useState([])
  const [monthlyProgress, setMonthlyProgress] = useState([])
  const [badgesData, setBadgesData] = useState([])
  const [isQuestModalVisible, setIsQuestModalVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [isDateActivitiesModalVisible, setIsDateActivitiesModalVisible] = useState(false)
  const [dateActivities, setDateActivities] = useState([])

  // Time period dropdown state
  const [timePeriod, setTimePeriod] = useState("week") // 'week' or 'month'
  const [isTimeDropdownVisible, setIsTimeDropdownVisible] = useState(false)

  // New state for activity details modal
  const [isActivityModalVisible, setIsActivityModalVisible] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [selectedDate, setSelectedDate] = useState(new Date())

  // Animation values for the flyover effect
  const mapZoomAnim = useRef(new Animated.Value(0)).current
  const mapPitchAnim = useRef(new Animated.Value(0)).current
  const mapHeadingAnim = useRef(new Animated.Value(0)).current
  const modalScaleAnim = useRef(new Animated.Value(0)).current
  const mapRef = useRef(null)
  const cameraAnimationInProgress = useRef(false)

  const weekDates = useMemo(() => getWeekDates(), [])
  const monthCalendar = useMemo(() => getMonthCalendar(), [])
  const { width } = Dimensions.get("window")

  // Add this state in the DashboardScreen component
  const [showRouteAnimation, setShowRouteAnimation] = useState(false)

  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const badgesRef = collection(db, "badges")
        const badgesSnapshot = await getDocs(badgesRef)
        const badgesList = badgesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        setBadgesData(badgesList)
      } catch (err) {
        console.error("Error fetching badges:", err)
        setError("Failed to fetch badges.")
      }
    }
    fetchBadges()
  }, [])

  useEffect(() => {
    const getUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== "granted") {
          setError("Permission to access location was denied")
          console.warn("Location permission denied")
          return
        }
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000,
          distanceInterval: 10,
        })
        setUserLocation(location.coords)
      } catch (err) {
        console.error("Location error:", err.message)
        setError("Failed to get location. Please ensure location services are enabled.")
      }
    }
    getUserLocation()
  }, [])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const user = auth.currentUser
      if (!user) {
        setError("Please sign in to view activities")
        setLoading(false)
        return
      }

      // Determine date range based on selected time period
      let startDate, endDate

      if (timePeriod === "week") {
        const weekDates = getWeekDates()
        startDate = new Date(weekDates[0].date)
        startDate.setHours(0, 0, 0, 0)
        endDate = new Date(weekDates[6].date)
        endDate.setHours(23, 59, 59, 999)
      } else {
        // month
        const today = new Date()
        const year = today.getFullYear()
        const month = today.getMonth()
        startDate = new Date(year, month, 1)
        startDate.setHours(0, 0, 0, 0)
        endDate = new Date(year, month + 1, 0)
        endDate.setHours(23, 59, 59, 999)
      }

      const activitiesRef = collection(db, "activities")
      const activitiesQuery = query(
        activitiesRef,
        where("userId", "==", user.uid),
        where("createdAt", ">=", startDate),
        where("createdAt", "<=", endDate),
      )
      const activitiesSnapshot = await getDocs(activitiesQuery)

      const activitiesData = activitiesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      if (activitiesData.length > 0) {
        const latestActivity = activitiesData.sort(
          (a, b) => (b.createdAt?.toDate() || new Date()) - (a.createdAt?.toDate() || new Date()),
        )[0]
        const formattedDistance = latestActivity.distance
          ? `${Number.parseFloat(latestActivity.distance).toFixed(2)} km`
          : "0 km"
        const formattedDuration = latestActivity.duration ? formatTime(latestActivity.duration) : "0:00"
        const formattedPace = latestActivity.pace ? formatTime(latestActivity.pace) + "/km" : "0:00/km"
        setActivityData({
          coordinates: latestActivity.coordinates || [],
          distance: formattedDistance,
          duration: formattedDuration,
          steps: latestActivity.steps || 0,
          activityType: latestActivity.activityType || "walking",
          stats: {
            pace: formattedPace,
            avgSpeed: latestActivity.avgSpeed ? `${latestActivity.avgSpeed.toFixed(1)} km/h` : "0 km/h",
          },
        })
      }

      const questsRef = collection(db, "quests")
      const questsSnapshot = await getDocs(questsRef)
      const questsData = questsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        badgeImage: doc.data().badgeImage || null,
      }))
      setQuests(questsData)

      const todayQuest = questsData.find((q) => q.type === "daily")
      setDailyQuest(todayQuest)

      if (todayQuest) {
        // Process weekly progress
        const weekProgress = weekDates.map(({ date }) => {
          const startOfDay = new Date(date)
          startOfDay.setHours(0, 0, 0, 0)
          const endOfDay = new Date(date)
          endOfDay.setHours(23, 59, 59, 999)
          const dayActivities = activitiesData.filter((act) => {
            const actDate = act.createdAt?.toDate()
            return actDate >= startOfDay && actDate <= endOfDay
          })
          let totalValue = 0
          if (todayQuest.unit === "steps") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.steps || 0), 0)
          } else if (todayQuest.unit === "distance") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.distance || 0), 0)
          }
          const progress = Math.min(totalValue / todayQuest.goal, 1)
          return { date, progress, completed: progress >= 1 }
        })
        setWeeklyProgress(weekProgress)

        // Process monthly progress
        const monthProgress = monthCalendar.map(({ date, isCurrentMonth }) => {
          if (!date || !isCurrentMonth) return { date, progress: 0, completed: false }

          const startOfDay = new Date(date)
          startOfDay.setHours(0, 0, 0, 0)
          const endOfDay = new Date(date)
          endOfDay.setHours(23, 59, 59, 999)

          const dayActivities = activitiesData.filter((act) => {
            const actDate = act.createdAt?.toDate()
            return actDate >= startOfDay && actDate <= endOfDay
          })

          let totalValue = 0
          if (todayQuest.unit === "steps") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.steps || 0), 0)
          } else if (todayQuest.unit === "distance") {
            totalValue = dayActivities.reduce((sum, act) => sum + (act.distance || 0), 0)
          }

          const progress = Math.min(totalValue / todayQuest.goal, 1)
          return { date, progress, completed: progress >= 1 }
        })
        setMonthlyProgress(monthProgress)
      }

      setLoading(false)
      setQuestLoading(false)
      setRefreshing(false)
    } catch (err) {
      console.error("Error fetching data:", err)
      setError(err.message)
      setLoading(false)
      setQuestLoading(false)
      setRefreshing(false)
    }
  }, [timePeriod, weekDates, monthCalendar])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    fetchData()
  }, [fetchData])

  const calculateQuestProgress = (quest) => {
    if (!quest || !activityData) return 0
    const currentValue = quest.unit === "steps" ? activityData.steps : Number.parseFloat(activityData.distance)
    return Math.min(currentValue / quest.goal, 1)
  }

  const getQuestStatus = (quest) => {
    const progress = calculateQuestProgress(quest)
    if (progress >= 1) return "completed"
    if (progress > 0) return "in_progress"
    return "not_started"
  }

  const getCurrentQuestValue = (quest) => {
    if (!quest) return 0
    return quest.unit === "steps"
      ? Math.min(activityData.steps, quest.goal)
      : Math.min(Number.parseFloat(activityData.distance), quest.goal)
  }

  const getBadgeForQuest = (quest) => {
    if (!quest || !badgesData.length) return null
    return badgesData.find(
      (badge) => badge.id === quest.badgeId || badge.name?.toLowerCase() === quest.title?.toLowerCase(),
    )
  }

  // Navigate to activity screen with quest details
  const navigateToQuestActivity = (quest) => {
    setIsQuestModalVisible(false) // Close the modal if open

    navigateToActivity({
      questId: quest.id,
      title: quest.title,
      description: quest.description,
      goal: quest.goal,
      unit: quest.unit,
      progress: calculateQuestProgress(quest),
      status: getQuestStatus(quest),
      activityType: quest.activityType || "walking", // Default to walking if not specified
    })
  }

  // New function to view activity details in modal
  const viewActivityDetails = (activity) => {
    setSelectedActivity(activity)
    setIsActivityModalVisible(true)

    // Reset animation values
    mapZoomAnim.setValue(0)
    mapPitchAnim.setValue(0)
    mapHeadingAnim.setValue(0)
    modalScaleAnim.setValue(0)

    // Start modal animation
    Animated.timing(modalScaleAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
      easing: Easing.out(Easing.back(1.5)),
    }).start()

    // Start map flyover animation after a short delay
    setTimeout(() => {
      if (mapRef.current && activity.coordinates && activity.coordinates.length > 0) {
        startMapFlyoverAnimation(activity.coordinates)
      }
    }, 500)
  }

  // Function to start the map flyover animation
  const startMapFlyoverAnimation = (coordinates) => {
    if (cameraAnimationInProgress.current || !coordinates || coordinates.length < 2) return

    cameraAnimationInProgress.current = true

    // First animation: zoom out
    Animated.timing(mapZoomAnim, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: true,
      easing: Easing.inOut(Easing.cubic),
    }).start()

    // Second animation: tilt and rotate
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(mapPitchAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),
        Animated.timing(mapHeadingAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),
      ]).start(() => {
        cameraAnimationInProgress.current = false
      })

      // Update the camera position manually
      if (mapRef.current) {
        const centerCoord = coordinates[Math.floor(coordinates.length / 2)] || coordinates[0]
        mapRef.current.animateCamera(
          {
            center: centerCoord,
            pitch: 45,
            heading: 30,
            altitude: 0,
            zoom: 13,
          },
          { duration: 3000 },
        )
      }
    }, 1000)
  }

  // Function to resume activity from modal
  const resumeActivity = () => {
    setIsActivityModalVisible(false)

    if (selectedActivity) {
      navigateToActivity({
        activityType: selectedActivity.activityType,
        coordinates: selectedActivity.coordinates,
        stats: {
          distance: Number.parseFloat(selectedActivity.distance) * 1000,
          duration: selectedActivity.duration
            .split(":")
            .reduce((acc, time, index) => acc + Number.parseInt(time) * (index === 0 ? 60 : 1), 0),
          pace: selectedActivity.stats.pace
            .replace("/km", "")
            .split(":")
            .reduce((acc, time, index) => acc + Number.parseInt(time) * (index === 0 ? 60 : 1), 0),
          avgSpeed: Number.parseFloat(selectedActivity.stats.avgSpeed),
          steps: selectedActivity.steps,
        },
      })
    }
  }

  // Function to clear activity from modal
  const clearActivity = () => {
    setIsActivityModalVisible(false)

    // You can add confirmation dialog here if needed
    if (selectedActivity) {
      // Clear the activity data
      // This would typically involve a call to your backend or state management
      // For now, we'll just close the modal
    }
  }

  // Add this function in the DashboardScreen component
  const handleShareActivity = () => {
    setIsActivityModalVisible(false)
    setShowRouteAnimation(true)
  }

  // Add this function in the DashboardScreen component
  const handleAnimationClose = () => {
    setShowRouteAnimation(false)
  }

  // Add this function in the DashboardScreen component
  const handleAnimationShare = (videoUri) => {
    console.log("Video shared:", videoUri)
    // You can add analytics tracking here
  }

  // Toggle time period dropdown
  const toggleTimeDropdown = () => {
    setIsTimeDropdownVisible(!isTimeDropdownVisible)
  }

  // Select time period and close dropdown
  const selectTimePeriod = (period) => {
    setTimePeriod(period)
    setIsTimeDropdownVisible(false)
  }

  // Function to render a day cell in the month calendar
  const renderCalendarDay = (dayInfo, index) => {
    if (!dayInfo.isCurrentMonth) {
      return (
        <View key={index} style={twrnc`w-[14.28%] aspect-square items-center justify-center opacity-30`}>
          {dayInfo.day && <CustomText style={twrnc`text-gray-500 text-xs`}>{dayInfo.day}</CustomText>}
        </View>
      )
    }

    // Find progress data for this day
    const progressData = monthlyProgress[index] || { progress: 0, completed: false }
    const isCompleted = progressData.completed
    const progress = progressData.progress
    const isToday = dayInfo.isToday

    return (
      <TouchableOpacity
        key={index}
        style={twrnc`w-[14.28%] aspect-square items-center justify-center p-1`}
        activeOpacity={0.7}
        onPress={() => dayInfo.date && handleDaySelection(dayInfo.date)}
      >
        <View
          style={twrnc`w-full h-full rounded-full items-center justify-center
          ${isCompleted ? "bg-gradient-to-br from-[#FFC107] to-[#FFA000]" : progress > 0 ? "bg-[#FFC107] bg-opacity-60" : "bg-[#2A2E3A]"}
          ${isToday ? "border-2 border-[#4361EE] shadow-[#4361EE] shadow-opacity-50" : ""}`}
        >
          {isCompleted ? (
            <FontAwesome name="check" size={16} color="#121826" />
          ) : progress > 0 ? (
            <View style={twrnc`items-center`}>
              <CustomText weight={isToday ? "bold" : "medium"} style={twrnc`text-white text-xs`}>
                {dayInfo.day}
              </CustomText>
              <CustomText style={twrnc`text-white text-[10px]`}>{Math.round(progress * 100)}%</CustomText>
            </View>
          ) : (
            <CustomText weight={isToday ? "bold" : "medium"} style={twrnc`text-white text-sm`}>
              {dayInfo.day}
            </CustomText>
          )}
        </View>
      </TouchableOpacity>
    )
  }

  const handleDaySelection = async (date) => {
    try {
      setSelectedDate(date)
      setLoading(true)

      const user = auth.currentUser
      if (!user) {
        setError("Please sign in to view activities")
        setLoading(false)
        return
      }

      // Set start and end of the selected day
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      // Query activities for the selected day
      const activitiesRef = collection(db, "activities")
      const activitiesQuery = query(
        activitiesRef,
        where("userId", "==", user.uid),
        where("createdAt", ">=", startOfDay),
        where("createdAt", "<=", endOfDay),
      )
      const activitiesSnapshot = await getDocs(activitiesQuery)

      const activitiesData = activitiesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        // Format the data for display
        formattedDistance: doc.data().distance ? `${Number.parseFloat(doc.data().distance).toFixed(2)} km` : "0 km",
        formattedDuration: doc.data().duration ? formatTime(doc.data().duration) : "0:00",
        formattedPace: doc.data().pace ? formatTime(doc.data().pace) + "/km" : "0:00/km",
        formattedAvgSpeed: doc.data().avgSpeed ? `${doc.data().avgSpeed.toFixed(1)} km/h` : "0 km/h",
      }))

      if (activitiesData.length > 0) {
        // Sort activities by time (newest first)
        activitiesData.sort((a, b) =>
          (b.createdAt?.toDate() || new Date()) - (a.createdAt?.toDate() || new Date())
        )

        // Set all activities for the day
        setDateActivities(activitiesData)
      } else {
        // No activities found for this day
        setDateActivities([])
      }

      setIsDateActivitiesModalVisible(true)
      setLoading(false)
    } catch (err) {
      console.error("Error fetching day activities:", err)
      setError(err.message)
      setLoading(false)
    }
  }
  if (loading || questLoading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <CustomText style={twrnc`text-white mt-4`}>Loading Dashboard...</CustomText>
      </View>
    )
  }

  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <FontAwesome name="exclamation-circle" size={50} color="#FFC107" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-red-500 text-center mb-4`}>Error: {error}</CustomText>
        <TouchableOpacity style={twrnc`bg-[#4361EE] px-6 py-3 rounded-lg`} onPress={fetchData}>
          <CustomText style={twrnc`text-white font-bold`}>Try Again</CustomText>
        </TouchableOpacity>
      </View>
    )
  }

  // Calculate interpolated camera values for the flyover animation
  const zoomLevel = mapZoomAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [15, 13], // Zoom out
  })

  const mapPitch = mapPitchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 45], // Tilt up
  })

  const mapHeading = mapHeadingAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 30, 0], // Rotate and come back
  })

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <ScrollView
        style={twrnc`flex-1`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
            colors={["#4361EE", "#FFC107"]}
          />
        }
      >
        <View style={twrnc`px-5 mt-6`}>
          <View style={twrnc`flex-row justify-between items-center mb-5`}>
            <CustomText weight="bold" style={twrnc`text-white text-xl tracking-tight shadow-sm`}>
              Your Progress
            </CustomText>

            {/* Time Period Dropdown */}
            <View style={twrnc`relative`}>
              <TouchableOpacity
                style={twrnc`flex-row items-center bg-[#2A2E3A] rounded-full px-4 py-1.5 shadow-sm active:opacity-80`}
                onPress={toggleTimeDropdown}
              >
                <CustomText style={twrnc`text-white text-sm font-medium mr-1`}>
                  {timePeriod === "week" ? "Week" : "Month"}
                </CustomText>
                <FontAwesome name="caret-down" size={14} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Dropdown Menu */}
              {isTimeDropdownVisible && (
                <View
                  style={twrnc`absolute top-10 right-0 bg-[#2A2E3A] rounded-xl shadow-lg z-10 w-32 overflow-hidden`}
                >
                  <TouchableOpacity
                    style={twrnc`px-4 py-3 border-b border-[#3A3F4B] ${timePeriod === "week" ? "bg-[#3A3F4B]" : ""}`}
                    onPress={() => selectTimePeriod("week")}
                  >
                    <CustomText style={twrnc`text-white text-sm`}>Week</CustomText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={twrnc`px-4 py-3 ${timePeriod === "month" ? "bg-[#3A3F4B]" : ""}`}
                    onPress={() => selectTimePeriod("month")}
                  >
                    <CustomText style={twrnc`text-white text-sm`}>Month</CustomText>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Week View */}
          {timePeriod === "week" && (
            <View style={twrnc`flex-row justify-between mb-6`}>
              {weekDates.map((day, index) => {
                const progressData = weeklyProgress[index] || { progress: 0, completed: false }
                const isCompleted = progressData.completed
                const progress = progressData.progress
                return (
                  <TouchableOpacity
                    key={index}
                    style={twrnc`items-center justify-center rounded-full w-12 h-12 shadow-md
              ${isCompleted ? "bg-gradient-to-br from-[#FFC107] to-[#FFA000]" : progress > 0 ? "bg-[#FFC107] bg-opacity-60" : "bg-[#2A2E3A]"}
              ${day.isToday ? "border-2 border-[#4361EE] shadow-[#4361EE] shadow-opacity-50" : ""}`}
                    activeOpacity={0.7}
                    onPress={() => day.date && handleDaySelection(day.date)}
                  >
                    {isCompleted ? (
                      <FontAwesome name="check" size={22} color="#121826" />
                    ) : progress > 0 ? (
                      <CustomText weight={day.isToday ? "bold" : "medium"} style={twrnc`text-white text-xs`}>
                        {Math.round(progress * 100)}%
                      </CustomText>
                    ) : (
                      <CustomText weight={day.isToday ? "bold" : "medium"} style={twrnc`text-white text-sm`}>
                        {day.day}
                      </CustomText>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          )}

          {/* Month Calendar View */}
          {timePeriod === "month" && (
            <View style={twrnc`mb-6`}>
              {/* Month and Year Header */}
              <CustomText weight="bold" style={twrnc`text-white text-center mb-2`}>
                {getMonthYearString()}
              </CustomText>

              {/* Weekday Headers */}
              <View style={twrnc`flex-row justify-between mb-2`}>
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                  <View key={index} style={twrnc`w-[14.28%] items-center`}>
                    <CustomText style={twrnc`text-gray-400 text-xs font-medium`}>{day}</CustomText>
                  </View>
                ))}
              </View>

              {/* Calendar Grid */}
              <View style={twrnc`flex-row flex-wrap`}>
                {monthCalendar.map((day, index) => renderCalendarDay(day, index))}
              </View>

              {/* Legend */}
              <View style={twrnc`flex-row justify-center mt-2`}>
                <View style={twrnc`flex-row items-center mr-4`}>
                  <View style={twrnc`w-3 h-3 rounded-full bg-[#2A2E3A] mr-1`} />
                  <CustomText style={twrnc`text-gray-400 text-xs`}>Not Started</CustomText>
                </View>
                <View style={twrnc`flex-row items-center mr-4`}>
                  <View style={twrnc`w-3 h-3 rounded-full bg-[#FFC107] bg-opacity-60 mr-1`} />
                  <CustomText style={twrnc`text-gray-400 text-xs`}>In Progress</CustomText>
                </View>
                <View style={twrnc`flex-row items-center`}>
                  <View style={twrnc`w-3 h-3 rounded-full bg-[#FFC107] mr-1`} />
                  <CustomText style={twrnc`text-gray-400 text-xs`}>Completed</CustomText>
                </View>
              </View>
            </View>
          )}

          <View style={twrnc`flex-row justify-between bg-[#2A2E3A] rounded-2xl p-5 mb-5 shadow-md`}>
            <View style={twrnc`items-center flex-1`}>
              <View style={twrnc`flex-row items-center mb-1`}>
                <Feather name="activity" size={16} color="#FFC107" style={twrnc`mr-1`} />
                <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                  {activityData.steps.toLocaleString()}
                </CustomText>
              </View>
              <CustomText style={twrnc`text-gray-400 text-xs`}>Today's Steps</CustomText>
            </View>
            <View style={twrnc`items-center flex-1 border-l border-r border-[#3A3F4B] px-6`}>
              <View style={twrnc`flex-row items-center mb-1`}>
                <FontAwesome name="map-marker" size={16} color="#FFC107" style={twrnc`mr-1`} />
                <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                  {activityData.distance}
                </CustomText>
              </View>
              <CustomText style={twrnc`text-gray-400 text-xs`}>Distance</CustomText>
            </View>
            <View style={twrnc`items-center flex-1`}>
              <View style={twrnc`flex-row items-center mb-1`}>
                <FontAwesome name="clock-o" size={16} color="#FFC107" style={twrnc`mr-1`} />
                <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                  {activityData.duration}
                </CustomText>
              </View>
              <CustomText style={twrnc`text-gray-400 text-xs`}>Active Time</CustomText>
            </View>
          </View>
        </View>

        {/* Daily Quest Card */}
        {dailyQuest && (
          <View style={twrnc`mx-5 bg-[#2A2E3A] rounded-xl p-4 mb-5`}>
            <View style={twrnc`flex-row justify-between items-center mb-2`}>
              <View style={twrnc`flex-row items-center flex-1`}>
                {(() => {
                  const badge = getBadgeForQuest(dailyQuest)
                  return badge && badge.imageUrl ? (
                    <Image
                      source={{ uri: badge.imageUrl }}
                      style={twrnc`w-8 h-8 rounded-full mr-3`}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={twrnc`bg-[#FFC107] rounded-full p-2 mr-3`}>
                      <FontAwesome name="trophy" size={18} color="#121826" />
                    </View>
                  )
                })()}
                <View style={twrnc`flex-1`}>
                  <CustomText
                    weight="bold"
                    style={twrnc`text-white text-base mb-1`}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {dailyQuest.title}
                  </CustomText>
                  <CustomText style={twrnc`text-gray-400 text-xs`} numberOfLines={2} ellipsizeMode="tail">
                    {dailyQuest.description}
                  </CustomText>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  twrnc`rounded-full px-4 py-2 min-w-[100px] items-center`,
                  getQuestStatus(dailyQuest) === "completed" ? twrnc`bg-[#4CAF50]` : twrnc`bg-[#FFC107]`,
                ]}
                onPress={() => navigateToQuestActivity(dailyQuest)}
              >
                <CustomText weight="bold" style={twrnc`text-[#121826] text-sm`}>
                  {getQuestStatus(dailyQuest) === "completed" ? "Completed ✓" : "Start Now"}
                </CustomText>
              </TouchableOpacity>
            </View>
            <View style={twrnc`flex-row items-center justify-between mt-2`}>
              <View style={twrnc`flex-1 mr-2`}>
                <View style={twrnc`h-2 bg-[#3A3F4B] rounded-full overflow-hidden`}>
                  <View
                    style={[
                      twrnc`h-2 rounded-full`,
                      {
                        width: `${calculateQuestProgress(dailyQuest) * 100}%`,
                        backgroundColor: getQuestStatus(dailyQuest) === "completed" ? "#4CAF50" : "#FFC107",
                      },
                    ]}
                  />
                </View>
              </View>
              <CustomText
                style={[
                  twrnc`text-xs font-medium`,
                  getQuestStatus(dailyQuest) === "completed" ? twrnc`text-[#4CAF50]` : twrnc`text-[#FFC107]`,
                ]}
              >
                {Math.round(calculateQuestProgress(dailyQuest) * 100)}% • {getCurrentQuestValue(dailyQuest)}/
                {dailyQuest.goal} {dailyQuest.unit}
              </CustomText>
            </View>
            {/* View Quests Button */}
            <TouchableOpacity
              style={twrnc`flex-row items-center bg-[#4361EE] rounded-full px-3 py-2 mt-3 justify-center`}
              onPress={() => setIsQuestModalVisible(true)}
            >
              <FontAwesome name="list" size={16} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText style={twrnc`text-white text-sm font-semibold`}>View All Quests</CustomText>
            </TouchableOpacity>
          </View>
        )}

        <View style={twrnc`px-5 mb-20`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>
            Last Activity
          </CustomText>
          <View style={twrnc`flex-row justify-between mb-4 ${width < 350 ? "flex-col" : ""}`}>
            <View style={twrnc`bg-[#2A2E3A] rounded-xl overflow-hidden ${width < 350 ? "w-full mb-3" : "w-1/2 mr-2"}`}>
              {activityData.coordinates.length > 0 ? (
                <MapView
                  style={twrnc`w-full h-40`}
                  initialRegion={calculateMapRegion(activityData.coordinates)}
                  customMapStyle={[
                    { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
                    { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
                    { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
                    { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFC107" }] },
                    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
                  ]}
                  provider={PROVIDER_GOOGLE}
                  scrollEnabled={true}
                  zoomEnabled={true}
                  pitchEnabled={true}
                  rotateEnabled={true}
                >
                  <Polyline coordinates={activityData.coordinates} strokeColor="#4361EE" strokeWidth={3} />
                </MapView>
              ) : (
                <View style={twrnc`w-full h-40 bg-[#2A2E3A] justify-center items-center p-4`}>
                  <FontAwesome name="map" size={24} color="#6B7280" style={twrnc`mb-2`} />
                  <CustomText style={twrnc`text-gray-400 text-sm text-center mb-2`}>
                    No recent activity. Start tracking now!
                  </CustomText>
                  <TouchableOpacity
                    style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`}
                    onPress={() => navigateToActivity()}
                  >
                    <CustomText style={twrnc`text-white text-sm`}>Start Activity</CustomText>
                  </TouchableOpacity>
                </View>
              )}
              <View style={twrnc`p-3`}>
                <CustomText style={twrnc`text-[#FFC107] font-medium`}>
                  {activityData.distance} • {activityData.duration}
                  {(activityData.activityType === "walking" || activityData.activityType === "jogging") &&
                    ` • ${activityData.steps} steps`}
                </CustomText>
              </View>
            </View>

            <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 ${width < 350 ? "w-full" : "w-1/2"}`}>
              <CustomText weight="semibold" style={twrnc`text-white text-base mb-3`}>
                {activityData.activityType.charAt(0).toUpperCase() + activityData.activityType.slice(1)}
              </CustomText>
              <CustomText style={twrnc`text-gray-400 text-sm mb-2`}>{formatDate()}</CustomText>
              <CustomText style={twrnc`text-[#FFC107] font-medium mb-2`}>
                Pace: {activityData.stats.pace} • Speed: {activityData.stats.avgSpeed}
              </CustomText>
              <TouchableOpacity
                style={twrnc`bg-[#4361EE] bg-opacity-20 rounded-lg px-4 py-2 mt-2`}
                onPress={() => viewActivityDetails(activityData)}
              >
                <CustomText style={twrnc`text-[#4361EE] text-sm font-medium text-center`}>View Details</CustomText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Quest List Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isQuestModalVisible}
        onRequestClose={() => setIsQuestModalVisible(false)}
      >
        <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
          <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-3/4`}>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                All Quests
              </CustomText>
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                onPress={() => setIsQuestModalVisible(false)}
              >
                <FontAwesome name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {quests.length > 0 ? (
                quests.map((quest, index) => {
                  const badge = getBadgeForQuest(quest)
                  const progress = calculateQuestProgress(quest)
                  const status = getQuestStatus(quest)

                  return (
                    <View
                      key={index}
                      style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-3 flex-row items-center justify-between`}
                    >
                      <View style={twrnc`flex-row items-center flex-1`}>
                        {badge && badge.imageUrl ? (
                          <Image
                            source={{ uri: badge.imageUrl }}
                            style={twrnc`w-10 h-10 rounded-full mr-3`}
                            resizeMode="contain"
                          />
                        ) : (
                          <View style={twrnc`bg-[#FFC107] rounded-full p-2 mr-3`}>
                            <FontAwesome name="trophy" size={18} color="#121826" />
                          </View>
                        )}
                        <View style={twrnc`flex-1`}>
                          <CustomText weight="bold" style={twrnc`text-white text-base mb-1`} numberOfLines={1}>
                            {quest.title}
                          </CustomText>
                          <CustomText style={twrnc`text-gray-400 text-xs mb-1`} numberOfLines={2}>
                            {quest.description}
                          </CustomText>
                          <View style={twrnc`flex-row items-center`}>
                            <View style={twrnc`flex-1 mr-2`}>
                              <View style={twrnc`h-2 bg-[#3A3F4B] rounded-full overflow-hidden`}>
                                <View
                                  style={[
                                    twrnc`h-2 rounded-full`,
                                    {
                                      width: `${progress * 100}%`,
                                      backgroundColor: status === "completed" ? "#4CAF50" : "#FFC107",
                                    },
                                  ]}
                                />
                              </View>
                            </View>
                            <CustomText
                              style={[
                                twrnc`text-xs font-medium`,
                                status === "completed" ? twrnc`text-[#4CAF50]` : twrnc`text-[#FFC107]`,
                              ]}
                            >
                              {Math.round(progress * 100)}%
                            </CustomText>
                          </View>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[
                          twrnc`rounded-full px-3 py-1`,
                          status === "completed" ? twrnc`bg-[#4CAF50]` : twrnc`bg-[#FFC107]`,
                        ]}
                        onPress={() => navigateToQuestActivity(quest)}
                      >
                        <CustomText weight="bold" style={twrnc`text-[#121826] text-xs`}>
                          {status === "completed" ? "Done" : "Start"}
                        </CustomText>
                      </TouchableOpacity>
                    </View>
                  )
                })
              ) : (
                <View style={twrnc`items-center justify-center py-10`}>
                  <FontAwesome name="exclamation-circle" size={40} color="#6B7280" style={twrnc`mb-4`} />
                  <CustomText style={twrnc`text-gray-400 text-center`}>No quests available.</CustomText>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Activity Details Modal */}
      <Modal
        animationType="none"
        transparent={true}
        visible={isActivityModalVisible}
        onRequestClose={() => setIsActivityModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsActivityModalVisible(false)}>
          <Animated.View
            style={[
              styles.modalContainer,
              {
                transform: [{ scale: modalScaleAnim }],
              },
            ]}
          >
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              {/* Modal Header */}
              <View style={twrnc`flex-row justify-between items-center mb-4`}>
                <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                  Activity Details
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                  onPress={() => setIsActivityModalVisible(false)}
                >
                  <FontAwesome name="close" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              {/* Map with Flyover Animation */}
              {selectedActivity && selectedActivity.coordinates && selectedActivity.coordinates.length > 0 ? (
                <View style={twrnc`w-full h-60 rounded-xl overflow-hidden mb-4`}>
                  <MapView
                    ref={mapRef}
                    style={twrnc`w-full h-full`}
                    initialRegion={calculateMapRegion(selectedActivity.coordinates)}
                    customMapStyle={[
                      { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
                      { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
                      { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
                      { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFC107" }] },
                      { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
                    ]}
                    provider={PROVIDER_GOOGLE}
                    scrollEnabled={true}
                    zoomEnabled={true}
                    pitchEnabled={true}
                    rotateEnabled={true}
                    camera={{
                      center:
                        selectedActivity.coordinates[Math.floor(selectedActivity.coordinates.length / 2)] ||
                        selectedActivity.coordinates[0],
                      pitch: mapPitch.__getValue(),
                      heading: mapHeading.__getValue(),
                      altitude: 0,
                      zoom: zoomLevel.__getValue(),
                    }}
                  >
                    <Polyline
                      coordinates={selectedActivity.coordinates}
                      strokeColor="#4361EE"
                      strokeWidth={4}
                      lineCap="round"
                      lineJoin="round"
                    />
                  </MapView>

                  {/* Map Overlay with Activity Type */}
                  <View style={twrnc`absolute top-3 left-3 bg-[#121826] bg-opacity-70 px-3 py-1 rounded-full`}>
                    <CustomText style={twrnc`text-white text-xs font-medium`}>
                      {selectedActivity.activityType.charAt(0).toUpperCase() + selectedActivity.activityType.slice(1)}
                    </CustomText>
                  </View>
                </View>
              ) : (
                <View style={twrnc`w-full h-40 bg-[#2A2E3A] justify-center items-center rounded-xl mb-4`}>
                  <FontAwesome name="map" size={24} color="#6B7280" style={twrnc`mb-2`} />
                  <CustomText style={twrnc`text-gray-400 text-sm text-center`}>No route data available</CustomText>
                </View>
              )}

              {/* Activity Stats */}
              {selectedActivity && (
                <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                  <CustomText weight="semibold" style={twrnc`text-white text-lg mb-3`}>
                    Activity Summary
                  </CustomText>

                  <View style={twrnc`flex-row justify-between mb-4`}>
                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Distance</CustomText>
                      <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                        {selectedActivity.distance
                          ? `${Number.parseFloat(selectedActivity.distance).toFixed(2)} km`
                          : "0 km"}
                      </CustomText>
                    </View>

                    <View style={twrnc`items-center flex-1 border-l border-r border-[#3A3F4B] px-2`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Duration</CustomText>
                      <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                        {selectedActivity.duration
                          ? (typeof selectedActivity.duration === "number"
                            ? formatTime(selectedActivity.duration)
                            : selectedActivity.duration)
                          : "0:00"}
                      </CustomText>
                    </View>

                    <View style={twrnc`items-center flex-1`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>
                        {selectedActivity.activityType === "cycling" ? "Speed" : "Steps"}
                      </CustomText>
                      <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                        {selectedActivity.activityType === "cycling"
                          ? (
                            selectedActivity.avgSpeed ??
                            selectedActivity.stats?.avgSpeed ??
                            "0"
                          ).toString().includes("km/h")
                            ? (selectedActivity.avgSpeed ?? selectedActivity.stats?.avgSpeed ?? "0 km/h")
                            : `${Number.parseFloat(selectedActivity.avgSpeed ?? selectedActivity.stats?.avgSpeed ?? 0).toFixed(1)} km/h`
                          : (selectedActivity.steps ?? 0).toLocaleString()}
                      </CustomText>
                    </View>
                  </View>

                  <View style={twrnc`flex-row justify-between`}>
                    <View style={twrnc`flex-1 mr-2`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Pace</CustomText>
                      <CustomText style={twrnc`text-white`}>
                        {selectedActivity.pace
                          ? (typeof selectedActivity.pace === "number"
                            ? formatTime(selectedActivity.pace)
                            : selectedActivity.pace) + "/km"
                          : selectedActivity.stats?.pace || "0:00/km"}
                      </CustomText>
                    </View>

                    <View style={twrnc`flex-1`}>
                      <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Date</CustomText>
                      <CustomText style={twrnc`text-white`}>
                        {selectedActivity.createdAt
                          ? formatDate(selectedActivity.createdAt.toDate ? selectedActivity.createdAt.toDate() : selectedActivity.createdAt)
                          : ""}
                      </CustomText>
                    </View>
                  </View>
                </View>
              )}

              {/* Action Buttons */}
              <View style={twrnc`flex-row justify-between`}>
                <TouchableOpacity style={twrnc`bg-[#4361EE] rounded-xl py-3 px-4 flex-1 mr-2`} onPress={resumeActivity}>
                  <CustomText weight="bold" style={twrnc`text-white text-center`}>
                    Resume Activity
                  </CustomText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={twrnc`border border-[#EF476F] rounded-xl py-3 px-4 flex-1 mr-2`}
                  onPress={clearActivity}
                >
                  <CustomText weight="bold" style={twrnc`text-[#EF476F] text-center`}>
                    Clear Activity
                  </CustomText>
                </TouchableOpacity>

                <TouchableOpacity style={twrnc`bg-[#FFD166] rounded-xl py-3 px-4 flex-1`} onPress={handleShareActivity}>
                  <CustomText weight="bold" style={twrnc`text-[#121826] text-center`}>
                    Share
                  </CustomText>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Date Activities Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isDateActivitiesModalVisible}
        onRequestClose={() => setIsDateActivitiesModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsDateActivitiesModalVisible(false)}>
          <View style={styles.modalContainer}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              {/* Modal Header */}
              <View style={twrnc`flex-row justify-between items-center mb-4`}>
                <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                  Activities for {formatDate(selectedDate)}
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                  onPress={() => setIsDateActivitiesModalVisible(false)}
                >
                  <FontAwesome name="close" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <ScrollView style={twrnc`max-h-96`}>
                {dateActivities.length > 0 ? (
                  dateActivities.map((activity, index) => (
                    <View key={index} style={twrnc`mb-4 bg-[#2A2E3A] rounded-xl p-4`}>
                      {/* Activity Header */}
                      <View style={twrnc`flex-row justify-between items-center mb-3`}>
                        <CustomText weight="bold" style={twrnc`text-white`}>
                          {activity.activityType.charAt(0).toUpperCase() + activity.activityType.slice(1)}
                        </CustomText>
                        <CustomText style={twrnc`text-gray-400 text-sm`}>
                          {activity.createdAt?.toDate
                            ? activity.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        </CustomText>
                      </View>

                      {/* Mini Map */}
                      {activity.coordinates && activity.coordinates.length > 0 && (
                        <View style={twrnc`h-32 rounded-lg overflow-hidden mb-3`}>
                          <MapView
                            style={twrnc`w-full h-full`}
                            initialRegion={calculateMapRegion(activity.coordinates)}
                            scrollEnabled={false}
                            zoomEnabled={false}
                            pitchEnabled={false}
                            rotateEnabled={false}
                          >
                            <Polyline
                              coordinates={activity.coordinates}
                              strokeColor="#4361EE"
                              strokeWidth={3}
                            />
                          </MapView>
                        </View>
                      )}

                      {/* Activity Stats */}
                      <View style={twrnc`flex-row justify-between`}>
                        <View>
                          <CustomText style={twrnc`text-gray-400 text-xs`}>Distance</CustomText>
                          <CustomText style={twrnc`text-white`}>{activity.formattedDistance}</CustomText>
                        </View>
                        <View>
                          <CustomText style={twrnc`text-gray-400 text-xs`}>Duration</CustomText>
                          <CustomText style={twrnc`text-white`}>{activity.formattedDuration}</CustomText>
                        </View>
                        <View>
                          <CustomText style={twrnc`text-gray-400 text-xs`}>Pace</CustomText>
                          <CustomText style={twrnc`text-white`}>{activity.formattedPace}</CustomText>
                        </View>
                      </View>

                      {/* View Details Button */}
                      <TouchableOpacity
                        style={twrnc`mt-3 bg-[#4361EE] bg-opacity-20 rounded-lg p-2`}
                        onPress={() => {
                          setIsDateActivitiesModalVisible(false)
                          viewActivityDetails(activity)
                        }}
                      >
                        <CustomText style={twrnc`text-[#4361EE] text-center`}>View Details</CustomText>
                      </TouchableOpacity>
                    </View>
                  ))
                ) : (
                  <View style={twrnc`items-center justify-center py-10`}>
                    <FontAwesome name="calendar-times-o" size={40} color="#6B7280" />
                    <CustomText style={twrnc`text-gray-400 mt-3`}>No activities for this day</CustomText>
                  </View>
                )}
              </ScrollView>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Route Animation Video Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={showRouteAnimation}
        onRequestClose={handleAnimationClose}
      >
        {/* Update the RouteAnimationVideo component call to pass the user's name from Firebase */}
        <RouteAnimationVideo
          coordinates={selectedActivity?.coordinates || []}
          activityType={selectedActivity?.activityType || "walking"}
          distance={selectedActivity?.distance || "0 km"}
          duration={selectedActivity?.duration || "0:00"}
          date={new Date().toISOString()} // Use actual activity date when available
          userName={auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "User"} // Get name from Firebase
          onClose={handleAnimationClose}
          onShare={handleAnimationShare}
        />
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "90%",
    maxHeight: "80%",
  },
  modalContent: {
    backgroundColor: "#121826",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
})

export default DashboardScreen
