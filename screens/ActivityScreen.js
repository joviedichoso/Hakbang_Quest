"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  View,
  TouchableOpacity,
  Image,
  Switch,
  TextInput,
  ScrollView,
  Animated,
  Dimensions,
  Platform,
  StatusBar,
} from "react-native"
import { FontAwesome } from "@expo/vector-icons"
import { Ionicons } from "@expo/vector-icons"
import Icon from "react-native-vector-icons/FontAwesome"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import { collection, getDocs, doc, getDoc } from "firebase/firestore"
import { db } from "../firebaseConfig"
import { LinearGradient } from "expo-linear-gradient"

// Import icons
import WalkingIcon from "../components/icons/walking.png"
import RunningIcon from "../components/icons/running.png"
import CyclingIcon from "../components/icons/cycling.png"
import JoggingIcon from "../components/icons/jogging.png"

const { width } = Dimensions.get("window")
const isAndroid = Platform.OS === "android"
const isSmallDevice = width < 375

const ActivityScreen = ({ navigateToDashboard, navigateToMap, params = {} }) => {
  const [gpsEnabled, setGpsEnabled] = useState(true)
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState(params.activityType || "walking")
  const [distance, setDistance] = useState(Number(params.distance) || 0)
  const [time, setTime] = useState(Number(params.time) || 0)
  const [calories, setCalories] = useState(0)
  const [coordinates, setCoordinates] = useState(params.coordinates || [])
  const [stats, setStats] = useState(
    params.stats || {
      distance: 0,
      duration: 0,
      pace: 0,
      avgSpeed: 0,
      steps: 0,
    },
  )

  const [challenges, setChallenges] = useState([])
  const [challengeLoading, setChallengeLoading] = useState(true)
  const [activeQuest, setActiveQuest] = useState(null)
  const [questBadge, setQuestBadge] = useState(null)
  const [pulseAnim] = useState(new Animated.Value(1))
  const [showSettings, setShowSettings] = useState(false)
  const [isViewingPastActivity, setIsViewingPastActivity] = useState(params.isViewingPastActivity || false)

  const activities = useMemo(
    () => [
      { id: "walking", name: "Walking", icon: WalkingIcon, met: 3.5, color: "#4361EE", iconColor: "#FFFFFF" },
      { id: "running", name: "Running", icon: RunningIcon, met: 8.0, color: "#EF476F", iconColor: "#FFFFFF" },
      { id: "cycling", name: "Cycling", icon: CyclingIcon, met: 6.0, color: "#06D6A0", iconColor: "#121826" },
      { id: "jogging", name: "Jogging", icon: JoggingIcon, met: 7.0, color: "#FFD166", iconColor: "#121826" },
    ],
    [],
  )

  const currentActivity = useMemo(
    () => activities.find((a) => a.id === selectedActivity) || activities[0],
    [activities, selectedActivity],
  )

  // Start pulsing animation for the quest banner
  useEffect(() => {
    if (activeQuest) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      ).start()
    }
  }, [activeQuest, pulseAnim])

  // Fetch quest details if questId is provided
  useEffect(() => {
    const fetchQuestDetails = async () => {
      if (params.questId) {
        try {
          const questDoc = await getDoc(doc(db, "quests", params.questId))
          if (questDoc.exists()) {
            const questData = { id: questDoc.id, ...questDoc.data() }
            setActiveQuest(questData)

            // Set appropriate activity type based on quest
            if (questData.activityType) {
              setSelectedActivity(questData.activityType)
            }

            // Fetch badge if available
            if (questData.badgeId) {
              const badgeDoc = await getDoc(doc(db, "badges", questData.badgeId))
              if (badgeDoc.exists()) {
                setQuestBadge({ id: badgeDoc.id, ...badgeDoc.data() })
              }
            }
          }
        } catch (err) {
          console.error("Error fetching quest details:", err)
        }
      } else if (params.title && params.description && params.goal && params.unit) {
        // If quest details are passed directly
        setActiveQuest({
          title: params.title,
          description: params.description,
          goal: params.goal,
          unit: params.unit,
          progress: params.progress || 0,
          status: params.status || "not_started",
        })
      }
    }

    fetchQuestDetails()
  }, [params])

  const calculateCalories = useCallback(() => {
    const weight = 70 // Default weight in kg
    const timeInHours = (Number.parseFloat(time) || 0) / 60
    const activity = activities.find((a) => a.id === selectedActivity)
    const kcal = (activity?.met || 3.5) * weight * timeInHours
    return Math.round(kcal)
  }, [time, selectedActivity, activities])

  const calculateTargetDistance = useCallback(() => {
    const timeInHours = (Number.parseFloat(time) || 0) / 60
    const speeds = { walking: 5, running: 10, cycling: 15, jogging: 8 }
    return (timeInHours * (speeds[selectedActivity] || 5)).toFixed(2)
  }, [time, selectedActivity])

  useEffect(() => {
    setCalories(calculateCalories())
  }, [calculateCalories])

  useEffect(() => {
    if (params?.activityType && selectedActivity !== params.activityType) {
      setDistance(calculateTargetDistance())
    }
  }, [selectedActivity, time, calculateTargetDistance, params])

  useEffect(() => {
    const fetchChallenges = async () => {
      try {
        const challengesRef = collection(db, "quests")
        const challengesSnapshot = await getDocs(challengesRef)
        const challengesData = challengesSnapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          // Filter out the active quest to avoid duplication
          .filter((challenge) => !activeQuest || challenge.id !== activeQuest.id)

        setChallenges(challengesData)
        setChallengeLoading(false)
      } catch (err) {
        console.error("Error fetching challenges:", err)
        setChallengeLoading(false)
      }
    }

    fetchChallenges()
  }, [activeQuest])

  const handleDistanceChange = useCallback((value) => {
    if (/^\d*\.?\d{0,2}$/.test(value) || value === "") {
      setDistance(value)
    }
  }, [])

  // Update the startActivity function to properly initialize stats:
  const startActivity = useCallback(() => {
    const activityConfig = activities.find((a) => a.id === selectedActivity)
    if (!gpsEnabled) {
      alert("GPS Tracking is disabled. Please enable it to start the activity.")
      return
    }

    // Reset stats for new activity with proper numeric values
    setStats({
      distance: 0,
      duration: 0,
      pace: 0,
      avgSpeed: 0,
      steps: 0,
    })

    // Debug log
    console.log("Starting new activity with reset stats")

    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: Number(distance) || 0,
      targetTime: Number(time) || 0,
      tracking: false,
      initialCoordinates: [],
      initialStats: { distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0 },
      activeQuest: activeQuest,
    })
  }, [gpsEnabled, selectedActivity, distance, time, navigateToMap, activeQuest, activities])

  // Update the resumeTracking function to properly handle stats
  const resumeTracking = useCallback(() => {
    const activityConfig = activities.find((a) => a.id === selectedActivity)

    // Ensure we have valid coordinates and stats before resuming
    const validCoordinates = coordinates && coordinates.length > 0 ? coordinates : []

    // Ensure stats has valid values and convert distance to number if it's a string
    const validStats = {
      distance: typeof stats.distance === "string" ? Number.parseFloat(stats.distance) : stats?.distance || 0,
      duration: stats?.duration || 0,
      pace: stats?.pace || 0,
      avgSpeed: stats?.avgSpeed || 0,
      steps: stats?.steps || 0,
    }

    // Log for debugging
    console.log("Resuming activity with stats:", validStats)
    console.log("Coordinates:", validCoordinates.length)

    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: distance || "0",
      targetTime: time || "0",
      tracking: true,
      initialCoordinates: validCoordinates,
      initialStats: validStats,
      activeQuest: activeQuest,
    })
  }, [activities, selectedActivity, distance, time, coordinates, stats, navigateToMap, activeQuest])

  const clearActivity = useCallback(() => {
    setCoordinates([])
    setStats({ distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0 })
    setIsViewingPastActivity(false) // Reset the viewing state
  }, [])

  // In the ActivityScreen component, update the useEffect that calculates metrics
  // Find the useEffect that depends on [stats.steps, distance] and replace it with:
  const calculateQuestProgress = useCallback(
    (quest) => {
      if (!quest) return 0
      // Make sure we're using numeric values for calculations
      const currentValue = quest.unit === "steps" ? stats.steps : Number.parseFloat(stats.distance || 0)
      const goalValue = Number.parseFloat(quest.goal || 0)
      return Math.min(currentValue / goalValue, 1)
    },
    [stats.steps, stats.distance],
  )

  const getQuestStatus = useCallback(
    (quest) => {
      const progress = calculateQuestProgress(quest)
      if (progress >= 1) return "completed"
      if (progress > 0) return "in_progress"
      return "not_started"
    },
    [calculateQuestProgress],
  )

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <StatusBar barStyle="light-content" backgroundColor="#121826" />

      {/* Header with gradient */}
      <LinearGradient
        colors={[currentActivity.color, "#121826"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={twrnc`pt-${isAndroid ? "10" : "12"} pb-6`}
      >
        <View style={twrnc`flex-row items-center justify-between px-5`}>
          <TouchableOpacity
            style={twrnc`p-2 -ml-2 rounded-full`}
            onPress={navigateToDashboard}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="angle-left" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          <CustomText weight="bold" style={twrnc`text-white text-xl`}>
            {currentActivity.name}
          </CustomText>

          <TouchableOpacity
            style={twrnc`p-2 -mr-2 rounded-full`}
            onPress={() => setShowSettings(!showSettings)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name={showSettings ? "close" : "settings-outline"} size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={twrnc`pb-20`} style={twrnc`flex-1`} showsVerticalScrollIndicator={false}>
        {/* Activity Icon and Start Button */}
        <View style={twrnc`items-center justify-center mt-6 mb-8`}>
          <View
            style={[
              twrnc`w-32 h-32 rounded-full items-center justify-center mb-6 shadow-lg`,
              { backgroundColor: currentActivity.color, shadowColor: currentActivity.color },
            ]}
          >
            <Image
              source={currentActivity.icon}
              style={[twrnc`w-16 h-16`, { tintColor: currentActivity.iconColor }]}
              resizeMode="contain"
            />
          </View>

          {coordinates.length > 0 ? (
            <View style={twrnc`w-full px-5`}>
              <TouchableOpacity
                style={[
                  twrnc`rounded-xl py-4 items-center mb-3 shadow-md`,
                  { backgroundColor: currentActivity.color, shadowColor: currentActivity.color },
                ]}
                onPress={resumeTracking}
              >
                <View style={twrnc`flex-row items-center`}>
                  <Ionicons name="play" size={24} color="#FFFFFF" style={twrnc`mr-2`} />
                  <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                    Resume Activity
                  </CustomText>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={twrnc`border border-[#EF476F] rounded-xl py-4 items-center`}
                onPress={clearActivity}
              >
                <View style={twrnc`flex-row items-center`}>
                  <Ionicons name="trash-outline" size={20} color="#EF476F" style={twrnc`mr-2`} />
                  <CustomText weight="bold" style={twrnc`text-[#EF476F] text-lg`}>
                    Clear Activity
                  </CustomText>
                </View>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                twrnc`rounded-xl py-4 px-8 items-center shadow-md`,
                { backgroundColor: currentActivity.color, shadowColor: currentActivity.color },
              ]}
              onPress={startActivity}
            >
              <View style={twrnc`flex-row items-center`}>
                <Ionicons name="play" size={24} color="#FFFFFF" style={twrnc`mr-2`} />
                <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                  {activeQuest ? "Start Quest" : "Start Tracking"}
                </CustomText>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Active Quest Banner */}
        {activeQuest && (
          <View style={twrnc`px-5 mb-6`}>
            <Animated.View style={[twrnc`overflow-hidden rounded-xl shadow-lg`, { transform: [{ scale: pulseAnim }] }]}>
              <LinearGradient
                colors={["#4361EE", "#3A0CA3"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={twrnc`p-4 rounded-xl`}
              >
                <View style={twrnc`flex-row items-center mb-2`}>
                  <View style={twrnc`bg-white bg-opacity-20 rounded-full p-2 mr-3`}>
                    {questBadge && questBadge.imageUrl ? (
                      <Image
                        source={{ uri: questBadge.imageUrl }}
                        style={twrnc`w-10 h-10 rounded-full`}
                        resizeMode="contain"
                      />
                    ) : (
                      <FontAwesome name="trophy" size={20} color="#FFD166" />
                    )}
                  </View>
                  <View style={twrnc`flex-1`}>
                    <CustomText weight="bold" style={twrnc`text-white text-lg mb-1`}>
                      {activeQuest.title}
                    </CustomText>
                    <CustomText style={twrnc`text-white text-opacity-80 text-sm`}>{activeQuest.description}</CustomText>
                  </View>
                </View>

                <View style={twrnc`mt-3`}>
                  <View style={twrnc`flex-row justify-between items-center mb-2`}>
                    <CustomText style={twrnc`text-white text-opacity-90 text-sm`}>Progress</CustomText>
                    <CustomText weight="bold" style={twrnc`text-white text-sm`}>
                      {Math.round(calculateQuestProgress(activeQuest) * 100)}%
                    </CustomText>
                  </View>
                  <View style={twrnc`h-3 bg-white bg-opacity-20 rounded-full overflow-hidden`}>
                    <View
                      style={[
                        twrnc`h-3 rounded-full`,
                        {
                          width: `${calculateQuestProgress(activeQuest) * 100}%`,
                          backgroundColor: getQuestStatus(activeQuest) === "completed" ? "#4CAF50" : "#FFD166",
                        },
                      ]}
                    />
                  </View>
                  <View style={twrnc`flex-row justify-between items-center mt-2`}>
                    <CustomText style={twrnc`text-white text-opacity-80 text-xs`}>
                      {activeQuest.unit === "steps"
                        ? `${Math.min(stats.steps || 0, activeQuest.goal).toLocaleString()} steps`
                        : `${Math.min(Number.parseFloat(distance) || 0, activeQuest.goal).toFixed(2)} km`}
                    </CustomText>
                    <CustomText style={twrnc`text-white text-opacity-80 text-xs`}>
                      Goal:{" "}
                      {activeQuest.unit === "steps"
                        ? `${activeQuest.goal.toLocaleString()} steps`
                        : `${activeQuest.goal} km`}
                    </CustomText>
                  </View>
                </View>

                <View style={twrnc`mt-4 flex-row justify-between items-center`}>
                  <View style={twrnc`flex-row items-center`}>
                    <FontAwesome name="info-circle" size={16} color="#FFFFFF" style={twrnc`mr-2`} />
                    <CustomText style={twrnc`text-white text-opacity-80 text-xs`}>
                      {activeQuest.unit === "steps"
                        ? "Steps are tracked automatically during your activity"
                        : "Distance is tracked via GPS during your activity"}
                    </CustomText>
                  </View>
                  {getQuestStatus(activeQuest) === "completed" && (
                    <View style={twrnc`bg-[#4CAF50] px-3 py-1 rounded-full`}>
                      <CustomText weight="bold" style={twrnc`text-white text-xs`}>
                        Completed
                      </CustomText>
                    </View>
                  )}
                </View>
              </LinearGradient>
            </Animated.View>
          </View>
        )}

        {/* Activity Selection */}
        {!showSettings && (
          <View style={twrnc`px-5 mb-6`}>
            <View style={twrnc`flex-row items-center mb-4`}>
              <Ionicons name="fitness" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                Choose Activity
              </CustomText>
            </View>

            <View style={twrnc`flex-row flex-wrap justify-between`}>
              {activities.map((activity) => (
                <TouchableOpacity
                  key={activity.id}
                  style={[
                    twrnc`rounded-xl p-4 items-center mb-4 shadow-md`,
                    {
                      backgroundColor: selectedActivity === activity.id ? activity.color : "#2A2E3A",
                      width: width < 350 ? "100%" : "48%",
                      borderWidth: activeQuest && activeQuest.activityType === activity.id ? 2 : 0,
                      borderColor: "#FFD166",
                      shadowColor: selectedActivity === activity.id ? activity.color : "transparent",
                    },
                  ]}
                  onPress={() => setSelectedActivity(activity.id)}
                >
                  <Image
                    source={activity.icon}
                    resizeMode="contain"
                    style={[
                      twrnc`w-10 h-10 mb-2`,
                      { tintColor: selectedActivity === activity.id ? activity.iconColor : "#FFFFFF" },
                    ]}
                  />
                  <CustomText
                    weight="medium"
                    style={{ color: selectedActivity === activity.id ? activity.iconColor : "#FFFFFF" }}
                  >
                    {activity.name}
                  </CustomText>
                  {activeQuest && activeQuest.activityType === activity.id && (
                    <View style={twrnc`absolute top-1 right-1 bg-[#FFD166] rounded-full p-1`}>
                      <FontAwesome name="star" size={12} color="#121826" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <View style={twrnc`px-5 mb-6`}>
            <View style={twrnc`flex-row items-center mb-4`}>
              <Ionicons name="options-outline" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                Activity Settings
              </CustomText>
            </View>

            {/* Distance Input - Optional */}
            <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-4 shadow-sm overflow-hidden`}>
              <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                <View style={twrnc`flex-row justify-between items-center`}>
                  <View style={twrnc`flex-row items-center`}>
                    <Ionicons name="map-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                    <CustomText weight="medium" style={twrnc`text-white`}>
                      Target Distance
                    </CustomText>
                  </View>
                  <View style={twrnc`flex-row items-center`}>
                    <TextInput
                      style={twrnc`text-white text-base bg-[#3A3F4B] rounded-l px-3 py-2 w-16 text-right`}
                      value={distance}
                      onChangeText={handleDistanceChange}
                      keyboardType="numeric"
                      placeholder="0.00"
                      placeholderTextColor="#888"
                    />
                    <View style={twrnc`bg-[#3A3F4B] rounded-r px-2 py-2`}>
                      <CustomText style={twrnc`text-gray-400`}>km</CustomText>
                    </View>
                  </View>
                </View>
                <CustomText style={twrnc`text-gray-400 text-xs mt-2 ml-8`}>Set a target distance (optional)</CustomText>
              </View>

              {/* Duration Input - Optional */}
              <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                <View style={twrnc`flex-row justify-between items-center mb-3`}>
                  <View style={twrnc`flex-row items-center`}>
                    <Ionicons name="time-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                    <CustomText weight="medium" style={twrnc`text-white`}>
                      Target Duration
                    </CustomText>
                  </View>
                </View>
                <View style={twrnc`flex-row flex-wrap justify-between ml-8`}>
                  {[10, 20, 30, 45, 60, 90].map((mins) => (
                    <TouchableOpacity
                      key={mins}
                      style={[
                        twrnc`w-[30%] mb-3 py-2 rounded-lg items-center`,
                        time === mins.toString()
                          ? {
                              backgroundColor: activities.find((a) => a.id === selectedActivity)?.color || "#4361EE",
                            }
                          : { backgroundColor: "#3A3F4B" },
                      ]}
                      onPress={() => setTime(mins.toString())}
                    >
                      <CustomText style={twrnc`text-white`}>{mins} min</CustomText>
                    </TouchableOpacity>
                  ))}
                </View>
                <CustomText style={twrnc`text-gray-400 text-xs mt-1 ml-8`}>Set a target duration (optional)</CustomText>
              </View>

              {/* Estimated Calories */}
              <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                <View style={twrnc`flex-row justify-between items-center`}>
                  <View style={twrnc`flex-row items-center`}>
                    <Ionicons name="flame-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                    <CustomText weight="medium" style={twrnc`text-white`}>
                      Estimated Calories
                    </CustomText>
                  </View>
                  <View style={twrnc`bg-[#3A3F4B] rounded px-3 py-1`}>
                    <CustomText weight="semibold" style={twrnc`text-[#FFC107]`}>
                      {calories} kcal
                    </CustomText>
                  </View>
                </View>
              </View>

              {/* GPS Tracking */}
              <View style={twrnc`p-4 border-b border-[#3A3F4B]`}>
                <View style={twrnc`flex-row justify-between items-center`}>
                  <View style={twrnc`flex-row items-center`}>
                    <Ionicons name="location-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                    <View>
                      <CustomText weight="medium" style={twrnc`text-white`}>
                        GPS Tracking
                      </CustomText>
                      <CustomText style={twrnc`text-gray-400 text-xs mt-1`}>Required for accurate tracking</CustomText>
                    </View>
                  </View>
                  <Switch
                    trackColor={{ false: "#3A3F4B", true: "#4361EE" }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor="#3A3F4B"
                    onValueChange={setGpsEnabled}
                    value={gpsEnabled}
                  />
                </View>
              </View>

              {/* Auto-Pause */}
              <View style={twrnc`p-4`}>
                <View style={twrnc`flex-row justify-between items-center`}>
                  <View style={twrnc`flex-row items-center`}>
                    <Ionicons name="pause-circle-outline" size={20} color="#FFFFFF" style={twrnc`mr-3`} />
                    <View>
                      <CustomText weight="medium" style={twrnc`text-white`}>
                        Auto-Pause
                      </CustomText>
                      <CustomText style={twrnc`text-gray-400 text-xs mt-1`}>Pause when you stop moving</CustomText>
                    </View>
                  </View>
                  <Switch
                    trackColor={{ false: "#3A3F4B", true: "#4361EE" }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor="#3A3F4B"
                    onValueChange={setAutoPauseEnabled}
                    value={autoPauseEnabled}
                  />
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Activity Stats (if resuming) */}
        {coordinates.length > 0 && (
          <View style={twrnc`px-5 mb-6`}>
            <View style={twrnc`flex-row items-center mb-4`}>
              <Ionicons name="stats-chart" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                Current Progress
              </CustomText>
            </View>

            <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 shadow-md`}>
              <View style={twrnc`flex-row justify-between mb-4`}>
                <View style={twrnc`items-center flex-1`}>
                  <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Distance</CustomText>
                  <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                    {(stats.distance / 1000).toFixed(2)}
                  </CustomText>
                  <CustomText style={twrnc`text-gray-400 text-xs`}>km</CustomText>
                </View>

                <View style={twrnc`items-center flex-1 border-l border-r border-[#3A3F4B] px-2`}>
                  <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>Duration</CustomText>
                  <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                    {Math.floor(stats.duration / 60)}:{(stats.duration % 60).toString().padStart(2, "0")}
                  </CustomText>
                  <CustomText style={twrnc`text-gray-400 text-xs`}>min:sec</CustomText>
                </View>

                <View style={twrnc`items-center flex-1`}>
                  <CustomText style={twrnc`text-gray-400 text-xs mb-1`}>
                    {selectedActivity === "cycling" ? "Speed" : "Steps"}
                  </CustomText>
                  <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                    {selectedActivity === "cycling" ? stats.avgSpeed.toFixed(1) : stats.steps.toLocaleString()}
                  </CustomText>
                  <CustomText style={twrnc`text-gray-400 text-xs`}>
                    {selectedActivity === "cycling" ? "km/h" : "steps"}
                  </CustomText>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Tips Section */}
        <View style={twrnc`px-5 mb-10`}>
          <View style={twrnc`flex-row items-center mb-4`}>
            <Ionicons name="bulb-outline" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
            <CustomText weight="bold" style={twrnc`text-white text-lg`}>
              Tips
            </CustomText>
          </View>

          <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 shadow-md`}>
            <View style={twrnc`flex-row items-start mb-3`}>
              <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              </View>
              <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                Keep your phone in an accessible position for better GPS accuracy
              </CustomText>
            </View>

            <View style={twrnc`flex-row items-start mb-3`}>
              <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              </View>
              <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                You can set optional goals or just start tracking without any targets
              </CustomText>
            </View>

            <View style={twrnc`flex-row items-start`}>
              <View style={twrnc`bg-[${currentActivity.color}] rounded-full p-1 mr-3 mt-0.5`}>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              </View>
              <CustomText style={twrnc`text-gray-300 text-sm flex-1`}>
                Complete quests to earn badges and track your fitness journey
              </CustomText>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Floating Action Button (for small screens) */}
      {!coordinates.length > 0 && isSmallDevice && (
        <View style={twrnc`absolute bottom-6 right-6`}>
          <TouchableOpacity
            style={[
              twrnc`w-16 h-16 rounded-full items-center justify-center shadow-lg`,
              { backgroundColor: currentActivity.color, shadowColor: currentActivity.color },
            ]}
            onPress={startActivity}
          >
            <Ionicons name="play" size={30} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

export default ActivityScreen