"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  View,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Dimensions,
} from "react-native"
import MapView, { Polyline } from "react-native-maps"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import { FontAwesome } from "@expo/vector-icons"
import { Feather } from "@expo/vector-icons"
import * as Location from "expo-location"
import { getDocs, collection, query, where } from "firebase/firestore"
import { db, auth } from "../firebaseConfig"
import { formatTime } from "../utils/activityUtils"

// Helper functions moved outside component for better performance
const formatDate = () => {
  const date = new Date()
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
  const maxLat = Math.max(...latitudes)
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
  const [badgesData, setBadgesData] = useState([])
  const [isQuestModalVisible, setIsQuestModalVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const weekDates = useMemo(() => getWeekDates(), [])
  const { width } = Dimensions.get("window")

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

      const weekDates = getWeekDates()
      const startOfWeek = new Date(weekDates[0].date)
      startOfWeek.setHours(0, 0, 0, 0)
      const endOfWeek = new Date(weekDates[6].date)
      endOfWeek.setHours(23, 59, 59, 999)

      const activitiesRef = collection(db, "activities")
      const activitiesQuery = query(
        activitiesRef,
        where("userId", "==", user.uid),
        where("createdAt", ">=", startOfWeek),
        where("createdAt", "<=", endOfWeek),
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
        const progress = weekDates.map(({ date }) => {
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
        setWeeklyProgress(progress)
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
  }, [])

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
            <TouchableOpacity
              style={twrnc`flex-row items-center bg-[#2A2E3A] rounded-full px-4 py-1.5 shadow-sm active:opacity-80`}
              onPress={() => console.log("Toggle Week/Month")} // Placeholder for future toggle
            >
              <CustomText style={twrnc`text-white text-sm font-medium mr-1`}>Week</CustomText>
              <FontAwesome name="caret-down" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

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
                  onPress={() => console.log(`View details for day ${day.day}`)} // Placeholder
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
                  provider="google"
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
                onPress={() =>
                  navigateToActivity({
                    activityType: activityData.activityType,
                    coordinates: activityData.coordinates,
                    stats: {
                      distance: Number.parseFloat(activityData.distance) * 1000,
                      duration: activityData.duration
                        .split(":")
                        .reduce((acc, time, index) => acc + Number.parseInt(time) * (index === 0 ? 60 : 1), 0),
                      pace: activityData.stats.pace
                        .replace("/km", "")
                        .split(":")
                        .reduce((acc, time, index) => acc + Number.parseInt(time) * (index === 0 ? 60 : 1), 0),
                      avgSpeed: Number.parseFloat(activityData.stats.avgSpeed),
                      steps: activityData.steps,
                    },
                  })
                }
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
    </View>
  )
}

export default DashboardScreen
