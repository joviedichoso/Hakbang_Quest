"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  SafeAreaView,
  StatusBar,
  View,
  TouchableOpacity,
  Image,
  Dimensions,
  Platform,
  BackHandler,
  ToastAndroid,
} from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SplashScreen from "expo-splash-screen"
import { useFonts } from "expo-font"
import * as Location from "expo-location"
import * as Notifications from "expo-notifications"
import twrnc from "twrnc"
import { FontAwesome } from "@expo/vector-icons"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc, collection, query, where, onSnapshot } from "firebase/firestore"
import { auth, db } from "./firebaseConfig"

import LandingScreen from "./screens/LandingScreen"
import LoginScreen from "./screens/LoginScreen"
import SignupScreen from "./screens/SignupScreen"
import DashboardScreen from "./screens/DashboardScreen"
import ActivityScreen from "./screens/ActivityScreen"
import ProfileScreen from "./screens/ProfileScreen"
import CommunityScreen from "./screens/CommunityScreen"
import LeaderboardScreen from "./screens/LeaderboardScreen"
import MapScreen from "./screens/MapScreen"
import CustomText from "./components/CustomText"
import CustomModal from "./components/CustomModal"
import NotificationDropdown from "./components/NotificationDropdown"
import NotificationService from "./services/NotificationService"

import RunningIcon from "./components/icons/running.png"
import FootprintsIcon from "./components/icons/footprints.png"

SplashScreen.preventAutoHideAsync()

const { width } = Dimensions.get("window")
const isSmallDevice = width < 375

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
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`
}

const requestLocationPermissions = async () => {
  try {
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync()
    if (status === "granted") return true

    if (!canAskAgain) {
      setModalTitle("Permission Required")
      setModalMessage("Location permissions are required. Please enable them in app settings.")
      setModalVisible(true)
      return false
    }

    setModalTitle("Permission Required")
    setModalMessage("This app needs location permissions to work properly.")
    setModalVisible(true)
    return false
  } catch (error) {
    console.error("Error requesting location permissions:", error)
    setModalTitle("Error")
    setModalMessage("Failed to request location permissions.")
    setModalVisible(true)
    return false
  }
}

const checkLocationPermissions = async () => {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync()
    return granted
  } catch (error) {
    console.error("Error checking location permissions:", error)
    setModalTitle("Error")
    setModalMessage("Failed to check location permissions.")
    setModalVisible(true)
    return false
  }
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState("landing")
  const [userName, setUserName] = useState("")
  const [activityParams, setActivityParams] = useState({})
  const [locationGranted, setLocationGranted] = useState(false)
  const [fontsLoaded] = useFonts({
    "Poppins-Regular": require("./assets/fonts/Poppins-Regular.ttf"),
    "Poppins-Medium": require("./assets/fonts/Poppins-Medium.ttf"),
    "Poppins-SemiBold": require("./assets/fonts/Poppins-SemiBold.ttf"),
    "Poppins-Bold": require("./assets/fonts/Poppins-Bold.ttf"),
  })

  const [isNavigationLocked, setIsNavigationLocked] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [modalTitle, setModalTitle] = useState("")
  const [modalMessage, setModalMessage] = useState("")
  const [verificationModalShown, setVerificationModalShown] = useState(false)
  const [loginEmail, setLoginEmail] = useState("")
  const [isInitializing, setIsInitializing] = useState(true)

  // Notification state
  const [notificationCount, setNotificationCount] = useState(0)
  const [notificationDropdownVisible, setNotificationDropdownVisible] = useState(false)
  const notificationListener = useRef()
  const responseListener = useRef()
  const notificationsUnsubscribe = useRef(null)

  // Back button handling
  const backPressedTimeRef = useRef(0)

  // Initialize notification listeners
  useEffect(() => {
    // Initialize notification service
    NotificationService.initialize()

    // Configure notification handler
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    })

    // Listen for notifications when app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      // Refresh notification count
      fetchNotificationCount()
    })

    // Listen for user interaction with notifications
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const { data } = response.notification.request.content
      handleNotificationNavigation(data)
    })

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current)
      Notifications.removeNotificationSubscription(responseListener.current)
      if (notificationsUnsubscribe.current) {
        notificationsUnsubscribe.current()
      }
    }
  }, [])

  // Handle back button press
  useEffect(() => {
    const handleBackPress = () => {
      // If navigation is locked, don't handle back button
      if (isNavigationLocked) {
        return true
      }

      // If we're on a screen with normal navigation, let the system handle it
      if (["activity", "profile", "community", "Leaderboard", "map"].includes(activeScreen)) {
        // For screens that should navigate back to dashboard
        if (["activity", "profile", "community", "Leaderboard"].includes(activeScreen)) {
          navigateToDashboard()
          return true
        }
        // For map screen, navigate to activity
        if (activeScreen === "map") {
          navigateToActivity()
          return true
        }
        return false
      }

      // If we're on a main screen (dashboard, landing), implement double-press to exit
      if (["dashboard", "landing"].includes(activeScreen)) {
        const currentTime = new Date().getTime()

        if (currentTime - backPressedTimeRef.current < 2000) {
          // Before exiting, save any important app state
          saveAppState()
          // Exit app if double-pressed within 2 seconds
          BackHandler.exitApp()
          return true
        }

        // Update the last press time
        backPressedTimeRef.current = currentTime

        // Show toast message
        ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT)

        // Return true to prevent default back behavior
        return true
      }

      // For login/signup screens, navigate to landing
      if (["signin", "signup"].includes(activeScreen)) {
        navigateToLanding()
        return true
      }

      // Default behavior for other screens
      return false
    }

    // Add event listener for the hardware back button
    const backHandler = BackHandler.addEventListener("hardwareBackPress", handleBackPress)

    // Clean up the event listener when component unmounts
    return () => backHandler.remove()
  }, [activeScreen, isNavigationLocked])

  // Save important app state before exiting
  const saveAppState = async () => {
    try {
      // Save current screen for restoration
      await AsyncStorage.setItem("lastActiveScreen", activeScreen)

      // Save any other important state here
      if (activityParams && Object.keys(activityParams).length > 0) {
        await AsyncStorage.setItem("activityParams", JSON.stringify(activityParams))
      }
    } catch (error) {
      console.error("Error saving app state:", error)
    }
  }

  // Handle notification navigation
  const handleNotificationNavigation = (data) => {
    if (!data) return

    // Navigate based on notification type
    if (data.type === "friendRequest" || data.type === "challenge" || data.type === "message") {
      setActiveScreen("community")
    } else if (data.type === "activity") {
      setActiveScreen("activity")
    }
  }

  // Fetch notification count
  const fetchNotificationCount = useCallback(() => {
    const user = auth.currentUser
    if (!user) return

    // Unsubscribe from previous listener
    if (notificationsUnsubscribe.current) {
      notificationsUnsubscribe.current()
    }

    // Set up listener for unread notifications count
    const notificationsRef = collection(db, "notifications")
    const unreadQuery = query(notificationsRef, where("userId", "==", user.uid), where("read", "==", false))

    const unsubscribe = onSnapshot(
      unreadQuery,
      (querySnapshot) => {
        setNotificationCount(querySnapshot.size)
      },
      (error) => {
        console.error("Error in notifications listener:", error)
      },
    )

    notificationsUnsubscribe.current = unsubscribe
  }, [])

  const handleAuthStateChange = useCallback(
    async (user) => {
      if (modalVisible) {
        return
      }

      if (user) {
        await AsyncStorage.setItem("userId", user.uid)
        try {
          const userDocRef = doc(db, "users", user.uid)
          const userDoc = await getDoc(userDocRef)
          if (userDoc.exists()) {
            const userData = userDoc.data()
            setUserName(userData.username || "User")

            // Save user data to AsyncStorage for offline access
            await AsyncStorage.setItem("userData", JSON.stringify(userData))
          } else {
            setUserName("User")
          }

          if (user.emailVerified) {
            if (isInitializing || ["landing", "signin", "signup"].includes(activeScreen)) {
              // Check if we should restore a previous screen
              const lastScreen = await AsyncStorage.getItem("lastActiveScreen")
              if (lastScreen && ["dashboard", "activity", "profile", "community", "Leaderboard"].includes(lastScreen)) {
                setActiveScreen(lastScreen)

                // Restore activity params if needed
                if (lastScreen === "activity") {
                  const savedParams = await AsyncStorage.getItem("activityParams")
                  if (savedParams) {
                    setActivityParams(JSON.parse(savedParams))
                  }
                }
              } else {
                setActiveScreen("dashboard")
              }
            }
            setIsNavigationLocked(false)
            setVerificationModalShown(false)

            // Fetch notification count when user is authenticated
            fetchNotificationCount()
          } else {
            if (!verificationModalShown) {
              setModalVisible(true)
              setModalTitle("Email Verification Required")
              setModalMessage("Please verify your email before logging in.")
              setVerificationModalShown(true)
            }
          }
        } catch (error) {
          console.error("Error fetching user data:", error)
          await auth.signOut()
        } finally {
          setIsInitializing(false)
        }
      } else {
        await AsyncStorage.removeItem("userId")
        setUserName("")
        if (["signin", "signup"].includes(activeScreen)) {
          setIsNavigationLocked(true)
        } else {
          setActiveScreen("landing")
          setIsNavigationLocked(false)
        }

        // Reset notification count when user logs out
        setNotificationCount(0)
        if (notificationsUnsubscribe.current) {
          notificationsUnsubscribe.current()
          notificationsUnsubscribe.current = null
        }

        setIsInitializing(false)
      }
    },
    [activeScreen, modalVisible, verificationModalShown, fetchNotificationCount, isInitializing],
  )

  useEffect(() => {
    const initApp = async () => {
      try {
        const isFirstLaunch = await AsyncStorage.getItem("isFirstLaunch")
        if (isFirstLaunch === null) {
          await AsyncStorage.setItem("isFirstLaunch", "true")
          setActiveScreen("landing")
          return
        }

        // Try to restore user data from AsyncStorage while waiting for Firebase
        const storedUserId = await AsyncStorage.getItem("userId")
        const storedUserData = await AsyncStorage.getItem("userData")

        if (storedUserId && storedUserData) {
          const userData = JSON.parse(storedUserData)
          setUserName(userData.username || "User")
        }

        const hasPermissions = await checkLocationPermissions()
        setLocationGranted(hasPermissions)
        if (!hasPermissions) {
          const granted = await requestLocationPermissions()
          setLocationGranted(granted)
        }

        const unsubscribe = onAuthStateChanged(auth, handleAuthStateChange)
        return unsubscribe
      } catch (err) {
        console.error("Initialization error:", err)
        setIsInitializing(false)
      } finally {
        await SplashScreen.hideAsync()
      }
    }
    initApp()
  }, [handleAuthStateChange])

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync()
  }, [fontsLoaded])

  const navigateToMap = (params = {}) => {
    if (!locationGranted) {
      setModalTitle("Location Required")
      setModalMessage("Please enable location services to use this feature.")
      setModalVisible(true)
      return
    }

    // Ensure numeric values for stats if they exist
    if (params.stats) {
      params.stats = {
        distance: Number(params.stats.distance || 0),
        duration: Number(params.stats.duration || 0),
        pace: Number(params.stats.pace || 0),
        avgSpeed: Number(params.stats.avgSpeed || 0),
        steps: Number(params.stats.steps || 0),
      }
    }

    // Log for debugging
    console.log("Navigating to map with params:", params)

    setActivityParams(params)
    setActiveScreen("map")
    setIsNavigationLocked(false)
  }

  const navigateToActivity = (params = {}) => {
    // Ensure numeric values for stats if they exist
    if (params.stats) {
      params.stats = {
        distance: Number(params.stats.distance || 0),
        duration: Number(params.stats.duration || 0),
        pace: Number(params.stats.pace || 0),
        avgSpeed: Number(params.stats.avgSpeed || 0),
        steps: Number(params.stats.steps || 0),
      }
    }

    // Log for debugging
    console.log("Navigating to activity with params:", params)

    setActivityParams(params)
    setActiveScreen("activity")
    setIsNavigationLocked(false)
  }

  const navigateToDashboard = () => {
    setActivityParams({})
    setActiveScreen("dashboard")
    setIsNavigationLocked(false)
  }

  const navigateToCommunity = () => {
    setActiveScreen("community")
    setIsNavigationLocked(false)
  }

  const navigateToSignIn = (email = "") => {
    setLoginEmail(email)
    setActiveScreen("signin")
    setIsNavigationLocked(true)
  }

  const navigateToSignUp = () => {
    setActiveScreen("signup")
    setIsNavigationLocked(true)
  }

  const navigateToLanding = () => {
    setActiveScreen("landing")
    setIsNavigationLocked(false)
  }

  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good Morning! Let's start the day strong!"
    if (hour < 17) return "Good Afternoon! Keep up the great work!"
    if (hour < 20) return "Good Evening! You're doing awesome!"
    return "Good Night! But if you're up for it, keep pushing your limits tonight!"
  }

  // Show loading indicator while initializing
  if (isInitializing) {
    return (
      <SafeAreaView style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <StatusBar barStyle={Platform.OS === "android" ? "light-content" : "dark-content"} backgroundColor="#121826" />
        <FontAwesome name="refresh" size={40} color="#FFC107" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-white text-center`}>Loading your fitness journey...</CustomText>
      </SafeAreaView>
    )
  }

  if (!fontsLoaded) return null

  return (
    <SafeAreaView style={twrnc`flex-1 bg-[#121826]`} onLayout={onLayoutRootView}>
      <StatusBar barStyle={Platform.OS === "android" ? "light-content" : "dark-content"} backgroundColor="#121826" />

      {!locationGranted && (
        <View style={twrnc`bg-yellow-600 p-2`}>
          <CustomText style={twrnc`text-white text-center`}>
            Location permissions are required for full functionality.
          </CustomText>
        </View>
      )}

      <CustomModal
        visible={modalVisible}
        title={modalTitle}
        message={modalMessage}
        onClose={() => {
          setModalVisible(false)
          setIsNavigationLocked(false)
          navigateToSignIn()
        }}
      />

      {/* Notification Dropdown */}
      <NotificationDropdown
        visible={notificationDropdownVisible}
        onClose={() => setNotificationDropdownVisible(false)}
        navigateToActivity={navigateToActivity}
        navigateToCommunity={navigateToCommunity}
      />

      {activeScreen === "dashboard" && (
        <>
          <View style={twrnc`p-5`}>
            <CustomText style={twrnc`text-gray-400 text-sm`}>{formatDate()}</CustomText>
            <View style={twrnc`flex-row justify-between items-center mt-2`}>
              <View style={twrnc`flex-1 flex-row items-center`}>
                <CustomText
                  weight="bold"
                  style={twrnc`text-white ${isSmallDevice ? "text-xl" : "text-2xl"} flex-shrink-1`}
                  numberOfLines={null}
                  ellipsizeMode="tail"
                >
                  {getTimeBasedGreeting()}, {userName}!
                </CustomText>
              </View>
              <View style={twrnc`flex-row`}>
                {/* Notification Bell with Badge */}
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] rounded-full w-10 h-10 items-center justify-center mr-2 relative`}
                  onPress={() => setNotificationDropdownVisible(true)}
                >
                  <FontAwesome name="bell" size={20} color="#fff" />
                  {notificationCount > 0 && (
                    <View
                      style={twrnc`absolute top-0 right-0 bg-[#EF476F] rounded-full min-w-5 h-5 items-center justify-center px-1`}
                    >
                      <CustomText style={twrnc`text-white text-xs font-bold`}>
                        {notificationCount > 99 ? "99+" : notificationCount}
                      </CustomText>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] rounded-full w-10 h-10 items-center justify-center`}
                  onPress={() => setActiveScreen("profile")}
                >
                  <FontAwesome name="user" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <DashboardScreen navigateToActivity={navigateToActivity} />
        </>
      )}

      {activeScreen === "landing" && (
        <LandingScreen navigateToSignIn={navigateToSignIn} navigateToSignUp={navigateToSignUp} />
      )}

      {activeScreen === "signin" && (
        <LoginScreen
          navigateToLanding={navigateToLanding}
          navigateToSignUp={navigateToSignUp}
          navigateToDashboard={navigateToDashboard}
          prefilledEmail={loginEmail}
        />
      )}

      {activeScreen === "signup" && (
        <SignupScreen
          navigateToLanding={navigateToLanding}
          navigateToSignIn={navigateToSignIn}
          setIsNavigationLocked={setIsNavigationLocked}
        />
      )}

      {activeScreen === "activity" && (
        <ActivityScreen
          navigateToDashboard={navigateToDashboard}
          navigateToMap={navigateToMap}
          params={activityParams}
        />
      )}

      {activeScreen === "profile" && (
        <ProfileScreen navigateToDashboard={navigateToDashboard} navigateToLanding={navigateToLanding} />
      )}

      {activeScreen === "community" && <CommunityScreen navigateToDashboard={navigateToDashboard} />}

      {activeScreen === "Leaderboard" &&
        (auth.currentUser ? (
          <LeaderboardScreen navigateToDashboard={navigateToDashboard} />
        ) : (
          <View style={twrnc`flex-1 bg-[#121826] justify-center items-center px-5`}>
            <FontAwesome name="lock" size={48} color="#FFC107" style={twrnc`mb-4`} />
            <CustomText style={twrnc`text-white text-center mb-4`}>Please sign in to view the leaderboard.</CustomText>
            <TouchableOpacity style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`} onPress={navigateToSignIn}>
              <CustomText style={twrnc`text-white`}>Sign In</CustomText>
            </TouchableOpacity>
          </View>
        ))}

      {activeScreen === "map" && (
        <MapScreen
          navigateToActivity={navigateToActivity}
          navigateToDashboard={navigateToDashboard}
          params={activityParams}
        />
      )}

      {(activeScreen === "dashboard" || activeScreen === "profile" || activeScreen === "Leaderboard") && (
        <View style={twrnc`flex-row justify-between items-center bg-[#1E2538] px-5 py-5 absolute bottom-0 w-full`}>
          <TouchableOpacity onPress={navigateToDashboard} style={twrnc`items-center`}>
            <FontAwesome name="home" size={30} color={activeScreen === "dashboard" ? "#FFC107" : "#FFFFFF"} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigateToActivity()} style={twrnc`items-center`}>
            <Image
              source={RunningIcon}
              style={{
                width: 30,
                height: 30,
                resizeMode: "contain",
                tintColor: activeScreen === "activity" ? "#FFC107" : "#FFFFFF",
              }}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigateToMap({})} style={twrnc`-mt-18`}>
            <View
              style={twrnc`bg-[#FFC107] w-20 h-20 rounded-full items-center justify-center shadow-lg shadow-black/50`}
            >
              <Image
                source={FootprintsIcon}
                style={{
                  width: 50,
                  height: 50,
                  resizeMode: "contain",
                  tintColor: "#FFFFFF",
                }}
              />
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setActiveScreen("Leaderboard")} style={twrnc`items-center`}>
            <FontAwesome name="trophy" size={30} color={activeScreen === "Leaderboard" ? "#FFC107" : "#FFFFFF"} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setActiveScreen("community")} style={twrnc`items-center`}>
            <FontAwesome name="users" size={30} color={activeScreen === "community" ? "#FFC107" : "#FFFFFF"} />
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}
