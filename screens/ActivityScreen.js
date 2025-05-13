"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  View,
  TouchableOpacity,
  Image,
  Switch,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
} from "react-native"
import { FontAwesome } from "@expo/vector-icons"
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

const ActivityScreen = ({ navigateToDashboard, navigateToMap, params = {} }) => {
  const [gpsEnabled, setGpsEnabled] = useState(true)
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState(params.activityType || "walking")
  const [distance, setDistance] = useState(params.distance || "5.00")
  const [time, setTime] = useState(params.time || "30")
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

  const activities = useMemo(
    () => [
      { id: "walking", name: "Walking", icon: WalkingIcon, met: 3.5, color: "#4361EE", iconColor: "#FFFFFF" },
      { id: "running", name: "Running", icon: RunningIcon, met: 8.0, color: "#EF476F", iconColor: "#FFFFFF" },
      { id: "cycling", name: "Cycling", icon: CyclingIcon, met: 6.0, color: "#06D6A0", iconColor: "#121826" },
      { id: "jogging", name: "Jogging", icon: JoggingIcon, met: 7.0, color: "#FFD166", iconColor: "#121826" },
    ],
    [],
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

  const startActivity = useCallback(() => {
    const activityConfig = activities.find((a) => a.id === selectedActivity)
    if (!gpsEnabled) {
      alert("GPS Tracking is disabled. Please enable it to start the activity.")
      return
    }
    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: distance,
      targetTime: time,
      tracking: false, // MapScreen will handle starting the tracking
      initialCoordinates: [],
      initialStats: { distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0 },
      activeQuest: activeQuest, // Pass the active quest to the map screen
    })
  }, [gpsEnabled, activities, selectedActivity, distance, time, navigateToMap, activeQuest])

  const resumeTracking = useCallback(() => {
    const activityConfig = activities.find((a) => a.id === selectedActivity)
    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: distance,
      targetTime: time,
      tracking: true,
      initialCoordinates: coordinates,
      initialStats: stats,
      activeQuest: activeQuest, // Pass the active quest to the map screen
    })
  }, [activities, selectedActivity, distance, time, coordinates, stats, navigateToMap, activeQuest])

  const clearActivity = useCallback(() => {
    setCoordinates([])
    setStats({ distance: 0, duration: 0, pace: 0, avgSpeed: 0, steps: 0 })
  }, [])

  const calculateQuestProgress = useCallback(
    (quest) => {
      if (!quest) return 0
      const currentValue = quest.unit === "steps" ? stats.steps : Number.parseFloat(distance)
      return Math.min(currentValue / quest.goal, 1)
    },
    [stats.steps, distance],
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
      <View style={twrnc`flex-row items-center p-5 bg-[#121826] border-b border-[#2A2E3A]`}>
        <TouchableOpacity style={twrnc`mr-4 z-10`} onPress={navigateToDashboard}>
          <Icon name="angle-left" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={twrnc`absolute left-0 right-0 items-center justify-center p-5`}>
          <CustomText weight="semibold" style={twrnc`text-white text-xl`}>
            {activities.find((a) => a.id === selectedActivity)?.name || "Activity"}
          </CustomText>
        </View>
      </View>

      <ScrollView contentContainerStyle={twrnc`p-5 pb-20`} style={twrnc`flex-1`}>
        {/* Active Quest Banner */}
        {activeQuest && (
          <Animated.View style={[twrnc`mb-6 overflow-hidden rounded-xl`, { transform: [{ scale: pulseAnim }] }]}>
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
        )}

        {/* Activity Selection */}
        <View style={twrnc`mb-6`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-3`}>
            Select Activity
          </CustomText>
          <View style={twrnc`flex-row flex-wrap justify-between`}>
            {activities.map((activity) => (
              <TouchableOpacity
                key={activity.id}
                style={[
                  twrnc`rounded-xl p-4 items-center mb-4`,
                  {
                    backgroundColor: selectedActivity === activity.id ? activity.color : "#2A2E3A",
                    width: width < 350 ? "100%" : "48%",
                    borderWidth: activeQuest && activeQuest.activityType === activity.id ? 2 : 0,
                    borderColor: "#FFD166",
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

        {/* Other Challenges Section */}
        

        {/* Activity Settings */}
        <View style={twrnc`mb-6`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-3`}>
            Activity Settings
          </CustomText>
          {/* Distance Input */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-3`}>
            <View style={twrnc`flex-row justify-between items-center p-4`}>
              <View style={twrnc`flex-row items-center`}>
                <FontAwesome name="map-o" size={18} color="#FFFFFF" style={twrnc`mr-2`} />
                <CustomText style={twrnc`text-white`}>Distance (km)</CustomText>
              </View>
              <TextInput
                style={twrnc`text-white text-lg bg-[#3A3F4B] rounded px-3 py-2 w-24 text-right`}
                value={distance}
                onChangeText={handleDistanceChange}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor="#888"
              />
            </View>
          </View>

          {/* Duration Input */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-3 p-4`}>
            <View style={twrnc`flex-row items-center mb-3`}>
              <FontAwesome name="clock-o" size={18} color="#FFFFFF" style={twrnc`mr-2`} />
              <CustomText style={twrnc`text-white`}>Duration (minutes)</CustomText>
            </View>
            <View style={twrnc`flex-row flex-wrap justify-between`}>
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
                  <CustomText style={twrnc`text-white`}>{mins}</CustomText>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Estimated Calories */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-3`}>
            <View style={twrnc`flex-row justify-between items-center p-4`}>
              <View style={twrnc`flex-row items-center`}>
                <FontAwesome name="fire" size={18} color="#FFFFFF" style={twrnc`mr-2`} />
                <CustomText style={twrnc`text-white`}>Estimated Calories</CustomText>
              </View>
              <CustomText weight="semibold" style={twrnc`text-[#FFC107] text-lg`}>
                {calories} kcal
              </CustomText>
            </View>
          </View>

          {/* GPS Tracking */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-3`}>
            <View style={twrnc`flex-row justify-between items-center p-4`}>
              <View style={twrnc`flex-row items-center`}>
                <FontAwesome name="map-marker" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
                <CustomText style={twrnc`text-white`}>GPS Tracking</CustomText>
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
          <View style={twrnc`bg-[#2A2E3A] rounded-xl`}>
            <View style={twrnc`flex-row justify-between items-center p-4`}>
              <View style={twrnc`flex-row items-center`}>
                <FontAwesome name="pause" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
                <CustomText style={twrnc`text-white`}>Auto-Pause</CustomText>
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

        {/* Start/Resume Activity */}
        <View style={twrnc`mt-4`}>
          {coordinates.length > 0 ? (
            <>
              <TouchableOpacity
                style={[
                  twrnc`rounded-xl py-4 items-center mb-3`,
                  { backgroundColor: activities.find((a) => a.id === selectedActivity)?.color || "#4361EE" },
                ]}
                onPress={resumeTracking}
              >
                <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                  Resume Activity
                </CustomText>
              </TouchableOpacity>
              <TouchableOpacity
                style={twrnc`border border-[#EF476F] rounded-xl py-4 items-center`}
                onPress={clearActivity}
              >
                <CustomText weight="bold" style={twrnc`text-[#EF476F] text-lg`}>
                  Clear Activity
                </CustomText>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[
                twrnc`rounded-xl py-4 items-center`,
                { backgroundColor: activities.find((a) => a.id === selectedActivity)?.color || "#4361EE" },
              ]}
              onPress={startActivity}
            >
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                {activeQuest ? "Start Quest Activity" : "Start Activity"}
              </CustomText>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  )
}

export default ActivityScreen
