"use client"

import { useState, useEffect } from "react"
import {
  View,
  TouchableOpacity,
  ScrollView,
  Image,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  Linking,
  Modal,
} from "react-native"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import { FontAwesome } from "@expo/vector-icons"
import { auth, db } from "../firebaseConfig"
import { signOut } from "firebase/auth"
import { doc, getDoc, collection, query, where, getDocs, updateDoc, setDoc } from "firebase/firestore"
import * as ImagePicker from "expo-image-picker"
import axios from "axios"
import CustomModal from "../components/CustomModal"
import AsyncStorage from "@react-native-async-storage/async-storage"

const ProfileScreen = ({ navigateToDashboard, navigateToLanding }) => {
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [showEditProfileModal, setShowEditProfileModal] = useState(false)
  const [showHelpSupportModal, setShowHelpSupportModal] = useState(false)
  const [showPrivacySettingsModal, setShowPrivacySettingsModal] = useState(false)
  const [editUsername, setEditUsername] = useState("")
  const [userData, setUserData] = useState({
    username: "User",
    email: "user@example.com",
    avatar: "https://randomuser.me/api/portraits/men/1.jpg",
    stats: {
      totalDistance: "0 km",
      totalActivities: "0",
      longestRun: "0 km",
    },
    badges: [],
    privacySettings: {
      showProfile: true,
      showActivities: true,
      showStats: true,
    },
  })
  const [loading, setLoading] = useState(true)
  const [badges, setBadges] = useState([])
  const [achievements, setAchievements] = useState([])
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [savingUsername, setSavingUsername] = useState(false)
  const [savingPrivacySettings, setSavingPrivacySettings] = useState(false)

  // First, add these state variables at the top of the component with the other state variables
  const [showEditProfileContent, setShowEditProfileContent] = useState(false)
  const [showHelpSupportContent, setShowHelpSupportContent] = useState(false)
  const [showPrivacySettingsContent, setShowPrivacySettingsContent] = useState(false)

  const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/dljywnlvh/image/upload"
  const CLOUDINARY_UPLOAD_PRESET = "profile"

  // FAQ content for Help & Support
  const faqItems = [
    {
      id: "1",
      question: "How do I track my activities?",
      answer:
        'To track your activities, go to the Dashboard and tap the "Start Activity" button. Choose your activity type and tap "Start". The app will track your route, distance, and duration automatically.',
    },
    {
      id: "2",
      question: "How do I earn badges?",
      answer:
        'Badges are earned by completing specific achievements. For example, complete your first 5km run to earn the "5K Runner" badge. Check the Achievements section to see what you need to do to earn each badge.',
    },
    {
      id: "3",
      question: "How can I reset my password?",
      answer:
        'To reset your password, go to the Login screen and tap "Forgot Password". Enter your email address and follow the instructions sent to your email.',
    },
  ]

  const settingsItems = [
    {
      id: "1",
      title: "Edit Profile",
      icon: "pencil",
      iconBg: "#4361EE",
      action: () => setShowEditProfileModal(true),
    },
    {
      id: "3",
      title: "Help & Support",
      icon: "question-circle",
      iconBg: "#4CC9F0",
      action: () => setShowHelpSupportModal(true),
    },
    {
      id: "4",
      title: "Privacy Settings",
      icon: "lock",
      iconBg: "#9C27B0",
      action: () => setShowPrivacySettingsModal(true),
    },
  ]

  const selectImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permissionResult.granted) {
        Alert.alert("Permission Denied", "Please grant access to your photo library to select an image.")
        return
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      })

      if (result.canceled) {
        console.log("User cancelled image picker")
        return
      }

      const uri = result.assets[0].uri
      const mimeType = result.assets[0].mimeType || "image/jpeg"
      await uploadImage(uri, mimeType)
    } catch (err) {
      console.error("Image picker error:", err.message, err.stack)
      Alert.alert("Error", "Failed to pick image. Please try again.")
    }
  }

  const uploadImage = async (uri, mimeType) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", {
        uri: Platform.OS === "ios" ? uri.replace("file://", "") : uri,
        type: mimeType,
        name: `profile.${mimeType.split("/")[1] || "jpg"}`,
      })
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET)

      const response = await axios.post(CLOUDINARY_URL, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      })

      if (!response.data.secure_url) {
        console.error("Cloudinary response:", JSON.stringify(response.data, null, 2))
        throw new Error("No secure_url in Cloudinary response")
      }

      const imageUrl = response.data.secure_url
      await saveImageUrlToFirestore(imageUrl)
      setUserData((prev) => ({ ...prev, avatar: imageUrl }))
      Alert.alert("Success", "Profile picture updated successfully")
    } catch (err) {
      console.error("Cloudinary upload error:", err.message, err.response?.data)
      Alert.alert(
        "Error",
        `Failed to upload image: ${err.response?.data?.error?.message || "Please check your network and try again."}`,
      )
    } finally {
      setUploading(false)
    }
  }

  const saveImageUrlToFirestore = async (imageUrl) => {
    try {
      const user = auth.currentUser
      if (!user) {
        throw new Error("Not authenticated")
      }
      const userRef = doc(db, "users", user.uid)
      const userDoc = await getDoc(userRef)

      if (userDoc.exists()) {
        await updateDoc(userRef, { avatar: imageUrl })
      } else {
        await setDoc(userRef, { avatar: imageUrl, username: userData.username || "User", email: user.email })
      }
      console.log("Image URL saved to Firestore")
    } catch (err) {
      console.error("Firestore update error:", err)
      throw err
    }
  }

  // In the saveUsername function, add validation for username length and special characters
  const saveUsername = async () => {
    if (!editUsername.trim()) {
      Alert.alert("Error", "Username cannot be empty")
      return
    }

    // Add validation for username length and special characters
    if (editUsername.length < 3) {
      Alert.alert("Error", "Username must be at least 3 characters long")
      return
    }

    if (!/^[a-zA-Z0-9_]+$/.test(editUsername)) {
      Alert.alert("Error", "Username can only contain letters, numbers, and underscores")
      return
    }

    setSavingUsername(true)
    try {
      const user = auth.currentUser
      if (!user) {
        throw new Error("Not authenticated")
      }
      const userRef = doc(db, "users", user.uid)
      await updateDoc(userRef, { username: editUsername })

      setUserData((prev) => ({ ...prev, username: editUsername }))
      setShowEditProfileModal(false)
      Alert.alert("Success", "Username updated successfully")

      // Save to AsyncStorage for offline access
      try {
        const userData = await AsyncStorage.getItem("userData")
        if (userData) {
          const parsedData = JSON.parse(userData)
          parsedData.username = editUsername
          await AsyncStorage.setItem("userData", JSON.stringify(parsedData))
        }
      } catch (storageErr) {
        console.warn("Could not save username to local storage:", storageErr)
      }
    } catch (err) {
      console.error("Error updating username:", err)
      Alert.alert("Error", "Failed to update username. Please try again.")
    } finally {
      setSavingUsername(false)
    }
  }

  // Enhance the savePrivacySettings function to include error handling and feedback
  const savePrivacySettings = async () => {
    setSavingPrivacySettings(true)
    try {
      const user = auth.currentUser
      if (!user) {
        throw new Error("Not authenticated")
      }

      // Log the settings being saved for debugging
      console.log("Saving privacy settings:", userData.privacySettings)

      const userRef = doc(db, "users", user.uid)
      await updateDoc(userRef, { privacySettings: userData.privacySettings })

      // Add a local storage backup of settings
      try {
        await AsyncStorage.setItem("privacySettings", JSON.stringify(userData.privacySettings))
      } catch (storageErr) {
        console.warn("Could not save privacy settings to local storage:", storageErr)
      }

      setShowPrivacySettingsModal(false)
      Alert.alert("Success", "Privacy settings updated successfully")
    } catch (err) {
      console.error("Error updating privacy settings:", err)
      Alert.alert("Error", "Failed to update privacy settings. Please try again.")
    } finally {
      setSavingPrivacySettings(false)
    }
  }

  const togglePrivacySetting = (setting) => {
    setUserData((prev) => ({
      ...prev,
      privacySettings: {
        ...prev.privacySettings,
        [setting]: !prev.privacySettings[setting],
      },
    }))
  }

  // Enhance the contactSupport function to include more options and better error handling
  const contactSupport = () => {
    Alert.alert("Contact Support", "How would you like to contact our support team?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Email",
        onPress: () => {
          const email = "support@hakbangquest.com"
          const subject = "HakbangQuest Support Request"
          const body = `User ID: ${auth.currentUser?.uid || "Not available"}\nEmail: ${userData.email}\n\nPlease describe your issue:`

          Linking.openURL(
            `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
          ).catch((err) => {
            console.error("Could not open email client:", err)
            Alert.alert(
              "Email Error",
              "Could not open email client. Please send an email manually to support@hakbangquest.com",
            )
          })
        },
      },
      {
        text: "Live Chat",
        onPress: () => {
          Alert.alert(
            "Live Chat",
            "Live chat support will be available in the next app update. Would you like to submit a ticket instead?",
            [
              { text: "No", style: "cancel" },
              {
                text: "Yes",
                onPress: () => {
                  // Redirect to ticket submission form or screen
                  Alert.alert("Ticket System", "The ticket system will be available in the next update.")
                },
              },
            ],
          )
        },
      },
      {
        text: "FAQ",
        onPress: () => {
          setShowHelpSupportModal(true)
        },
      },
    ])
  }

  // Add a function to handle FAQ item expansion
  const openFAQ = (faqItem) => {
    Alert.alert(faqItem.question, faqItem.answer, [
      {
        text: "OK",
      },
      {
        text: "More Help",
        onPress: () => contactSupport(),
      },
    ])
  }

  // Add a function to restore privacy settings from local storage if Firestore fails
  const restorePrivacySettingsFromStorage = async () => {
    try {
      const storedSettings = await AsyncStorage.getItem("privacySettings")
      if (storedSettings) {
        const parsedSettings = JSON.parse(storedSettings)
        setUserData((prev) => ({
          ...prev,
          privacySettings: parsedSettings,
        }))
        return true
      }
      return false
    } catch (err) {
      console.error("Error restoring privacy settings from storage:", err)
      return false
    }
  }

  // Enhance the fetchUserData function to handle offline mode and add error recovery
  const fetchUserData = async () => {
    try {
      const user = auth.currentUser
      if (!user) {
        throw new Error("Not authenticated")
      }

      let offlineMode = false
      let userData = null

      try {
        const userDoc = await getDoc(doc(db, "users", user.uid))
        if (userDoc.exists()) {
          userData = userDoc.data()
        }
      } catch (firestoreErr) {
        console.warn("Firestore error, trying to use cached data:", firestoreErr)
        offlineMode = true

        // Try to get cached user data
        try {
          const cachedUserData = await AsyncStorage.getItem("userData")
          if (cachedUserData) {
            userData = JSON.parse(cachedUserData)
            Alert.alert("Offline Mode", "Using cached data. Some features may be limited.")
          }
        } catch (cacheErr) {
          console.error("Cache retrieval error:", cacheErr)
        }

        if (!userData) {
          throw new Error("Could not retrieve user data. Please check your connection.")
        }
      }

      const username = userData?.username || "User"
      const avatar = userData?.avatar || "https://randomuser.me/api/portraits/men/1.jpg"
      const privacySettings = userData?.privacySettings || {
        showProfile: true,
        showActivities: true,
        showStats: true,
      }

      setEditUsername(username)

      // If we're in offline mode, use simplified data
      if (offlineMode) {
        setUserData({
          username,
          email: user.email || "user@example.com",
          avatar,
          stats: {
            totalDistance: "0 km",
            totalActivities: "0",
            longestRun: "0 km",
          },
          privacySettings,
        })

        // Try to restore privacy settings from local storage
        await restorePrivacySettingsFromStorage()

        setLoading(false)
        return
      }

      // If we're online, proceed with full data fetch
      try {
        const activitiesQuery = query(collection(db, "activities"), where("userId", "==", user.uid))
        const activitiesSnapshot = await getDocs(activitiesQuery)

        let totalDistance = 0
        let totalActivities = 0
        let longestRun = 0

        activitiesSnapshot.forEach((doc) => {
          const activity = doc.data()
          const distance = Number(activity.distance) || 0
          totalDistance += distance
          totalActivities += 1
          longestRun = Math.max(longestRun, distance)
        })

        const badgesQuery = query(collection(db, "userBadges"), where("userId", "==", user.uid))
        const badgesSnapshot = await getDocs(badgesQuery)
        const userBadges = badgesSnapshot.docs.map((doc) => doc.data().badgeId)

        const badgeDetails = []
        for (const badgeId of userBadges) {
          const badgeDoc = await getDoc(doc(db, "badges", badgeId))
          if (badgeDoc.exists()) {
            badgeDetails.push({
              id: badgeDoc.id,
              ...badgeDoc.data(),
            })
          }
        }

        const achievementsQuery = query(collection(db, "userAchievements"), where("userId", "==", user.uid))
        const achievementsSnapshot = await getDocs(achievementsQuery)
        const userAchievements = achievementsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))

        // Save user data to AsyncStorage for offline access
        const userDataToCache = {
          username,
          email: user.email,
          avatar,
          privacySettings,
        }
        await AsyncStorage.setItem("userData", JSON.stringify(userDataToCache))

        setUserData({
          username,
          email: user.email || "user@example.com",
          avatar,
          stats: {
            totalDistance: `${totalDistance.toFixed(1)} km`,
            totalActivities: `${totalActivities}`,
            longestRun: `${longestRun.toFixed(1)} km`,
          },
          privacySettings,
        })
        setBadges(badgeDetails)
        setAchievements(userAchievements)
      } catch (dataFetchErr) {
        console.error("Error fetching additional user data:", dataFetchErr)
        // If we can't fetch additional data, at least show basic profile
        setUserData({
          username,
          email: user.email || "user@example.com",
          avatar,
          stats: {
            totalDistance: "0 km",
            totalActivities: "0",
            longestRun: "0 km",
          },
          privacySettings,
        })

        // Try to restore privacy settings from local storage
        await restorePrivacySettingsFromStorage()

        Alert.alert("Limited Data", "Some profile data couldn't be loaded. Please check your connection.")
      }
    } catch (err) {
      console.error("Error fetching user data:", err)
      if (err.code === "permission-denied") {
        setError("Permission denied. Please sign in again.")
      } else {
        setError("Failed to load profile data. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUserData()
  }, [])

  const confirmLogout = async () => {
    try {
      await signOut(auth)
      navigateToLanding()
    } catch (err) {
      console.error("Logout error:", err)
      Alert.alert("Error", "Failed to log out. Please try again.")
    }
  }

  if (loading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <CustomText style={twrnc`text-white mt-4`}>Loading Profile...</CustomText>
      </View>
    )
  }

  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center px-5`}>
        <FontAwesome name="exclamation-circle" size={48} color="#EF4444" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-white text-center mb-4`}>{error}</CustomText>
        <TouchableOpacity
          style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`}
          onPress={() => {
            setError(null)
            setLoading(true)
            fetchUserData()
          }}
        >
          <CustomText style={twrnc`text-white`}>Retry</CustomText>
        </TouchableOpacity>
      </View>
    )
  }

  const renderStatItem = (value, label) => (
    <View style={twrnc`items-center flex-1`} key={label}>
      <CustomText weight="bold" style={twrnc`text-white text-xl mb-1`}>
        {value}
      </CustomText>
      <CustomText style={twrnc`text-gray-400 text-xs`}>{label}</CustomText>
    </View>
  )

  const renderAchievementItem = ({ item }) => (
    <View key={item.id} style={twrnc`w-[48%] bg-[#2A2E3A] rounded-xl p-4 mb-4 items-center`}>
      <View
        style={twrnc`w-16 h-16 rounded-full mb-3 items-center justify-center ${item.completed ? "bg-[#FFC107]" : "bg-[#3A3F4B]"}`}
      >
        <CustomText style={twrnc`text-white text-2xl`}>{item.title?.[0] || "?"}</CustomText>
      </View>
      <CustomText weight="medium" style={twrnc`text-white text-center ${!item.completed && "text-gray-500"}`}>
        {item.title || "Achievement"}
      </CustomText>
    </View>
  )

  const renderSettingItem = (item) => (
    <TouchableOpacity
      key={item.id}
      style={twrnc`flex-row items-center p-4 border-b border-[#3A3F4B]`}
      onPress={item.action}
    >
      <View style={twrnc`bg-[${item.iconBg}] rounded-full p-2 mr-3`}>
        <FontAwesome name={item.icon} size={18} color="#FFFFFF" />
      </View>
      <CustomText style={twrnc`text-white flex-1`}>{item.title}</CustomText>
      <FontAwesome name="angle-right" size={20} color="#FFFFFF" />
    </TouchableOpacity>
  )

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <ScrollView style={twrnc`flex-1`}>
        <View style={twrnc`px-5 mt-4`}>
          <View style={twrnc`flex-row justify-between items-center mb-6`}>
            <TouchableOpacity onPress={navigateToDashboard}>
              <FontAwesome name="angle-left" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>
              Profile
            </CustomText>
            <TouchableOpacity onPress={() => setShowLogoutModal(true)}>
              <FontAwesome name="sign-out" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={twrnc`items-center mb-8`}>
          <View style={twrnc`relative`}>
            <Image
              source={{ uri: userData.avatar }}
              style={twrnc`w-32 h-32 rounded-full border-4 border-[#FFC107] mb-4`}
              defaultSource={{ uri: "https://randomuser.me/api/portraits/men/1.jpg" }}
            />
            <TouchableOpacity
              style={twrnc`absolute bottom-4 right-2 bg-[#4361EE] rounded-full p-1 border-2 border-[#121826]`}
              onPress={selectImage}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <FontAwesome name="pencil" size={12} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
          <CustomText weight="bold" style={twrnc`text-white text-2xl mb-1`}>
            {userData.username}
          </CustomText>
          <CustomText style={twrnc`text-gray-400 text-base`}>{userData.email}</CustomText>
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>
            Your Stats
          </CustomText>
          <View style={twrnc`flex-row justify-between bg-[#2A2E3A] rounded-xl p-4`}>
            {renderStatItem(userData.stats.totalDistance, "Total Distance")}
            {renderStatItem(userData.stats.totalActivities, "Activities")}
            {renderStatItem(userData.stats.longestRun, "Longest Run")}
          </View>
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>
            Your Badges
          </CustomText>
          {badges.length > 0 ? (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={badges}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={twrnc`mr-4 items-center`}>
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={twrnc`w-20 h-20 rounded-full mb-2`}
                    defaultSource={{ uri: "https://via.placeholder.com/80" }}
                  />
                  <CustomText style={twrnc`text-white text-center`}>{item.name}</CustomText>
                </View>
              )}
              contentContainerStyle={twrnc`pb-2`}
            />
          ) : (
            <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 items-center`}>
              <CustomText style={twrnc`text-gray-400`}>No badges earned yet</CustomText>
            </View>
          )}
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>
            Achievements
          </CustomText>
          {achievements.length > 0 ? (
            <View style={twrnc`flex-row flex-wrap justify-between`}>
              {achievements.map((achievement) => renderAchievementItem({ item: achievement }))}
            </View>
          ) : (
            <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 items-center`}>
              <CustomText style={twrnc`text-gray-400`}>No achievements earned yet</CustomText>
            </View>
          )}
        </View>

        <View style={twrnc`px-5 mb-20`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>
            Settings
          </CustomText>
          <View style={twrnc`bg-[#2A2E3A] rounded-xl`}>{settingsItems.map((item) => renderSettingItem(item))}</View>
        </View>
      </ScrollView>

      {/* Logout Modal */}
      <CustomModal
        visible={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={confirmLogout}
        icon="sign-out"
        title="Confirm Logout"
        message="Are you sure you want to log out? Your progress will be saved automatically."
        type="warning"
      />

      {/* Edit Profile Modal - New style */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showEditProfileModal}
        onRequestClose={() => setShowEditProfileModal(false)}
      >
        <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
          <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-3/4`}>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                Edit Profile
              </CustomText>
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                onPress={() => setShowEditProfileModal(false)}
              >
                <FontAwesome name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                <CustomText style={twrnc`text-white mb-2`}>Username</CustomText>
                <TextInput
                  style={twrnc`bg-[#3A3F4B] text-white p-3 rounded-lg mb-4`}
                  value={editUsername}
                  onChangeText={setEditUsername}
                  placeholder="Enter username"
                  placeholderTextColor="#9CA3AF"
                />
                <CustomText style={twrnc`text-gray-400 text-xs mb-4`}>
                  Username must be at least 3 characters and can only contain letters, numbers, and underscores.
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#4361EE] p-3 rounded-lg items-center`}
                  onPress={saveUsername}
                  disabled={savingUsername}
                >
                  {savingUsername ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <CustomText weight="semibold" style={twrnc`text-white`}>
                      Save Changes
                    </CustomText>
                  )}
                </TouchableOpacity>
              </View>

              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                <CustomText weight="semibold" style={twrnc`text-white mb-2`}>
                  Profile Picture
                </CustomText>
                <View style={twrnc`items-center mb-4`}>
                  <Image
                    source={{ uri: userData.avatar }}
                    style={twrnc`w-24 h-24 rounded-full mb-4`}
                    defaultSource={{ uri: "https://randomuser.me/api/portraits/men/1.jpg" }}
                  />
                  <TouchableOpacity
                    style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`}
                    onPress={selectImage}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <CustomText style={twrnc`text-white`}>Change Picture</CustomText>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Help & Support Modal - New style */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showHelpSupportModal}
        onRequestClose={() => setShowHelpSupportModal(false)}
      >
        <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
          <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-3/4`}>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                Help & Support
              </CustomText>
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                onPress={() => setShowHelpSupportModal(false)}
              >
                <FontAwesome name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                <CustomText weight="semibold" style={twrnc`text-white mb-2`}>
                  Frequently Asked Questions
                </CustomText>
                {faqItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={twrnc`mb-2 py-2 border-b border-[#3A3F4B]`}
                    onPress={() => openFAQ(item)}
                  >
                    <CustomText style={twrnc`text-[#4CC9F0]`}>{item.question}</CustomText>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                <CustomText weight="semibold" style={twrnc`text-white mb-2`}>
                  Contact Support
                </CustomText>
                <CustomText style={twrnc`text-gray-300 mb-3`}>
                  Need help with something specific? Our support team is here to help.
                </CustomText>
                <TouchableOpacity style={twrnc`bg-[#4CC9F0] p-3 rounded-lg items-center`} onPress={contactSupport}>
                  <CustomText weight="semibold" style={twrnc`text-white`}>
                    Contact Support
                  </CustomText>
                </TouchableOpacity>
              </View>

              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                <CustomText weight="semibold" style={twrnc`text-white mb-2`}>
                  App Information
                </CustomText>
                <View style={twrnc`flex-row justify-between mb-2`}>
                  <CustomText style={twrnc`text-gray-400`}>Version</CustomText>
                  <CustomText style={twrnc`text-white`}>1.0.0</CustomText>
                </View>
                <View style={twrnc`flex-row justify-between`}>
                  <CustomText style={twrnc`text-gray-400`}>Build</CustomText>
                  <CustomText style={twrnc`text-white`}>May 19, 2025</CustomText>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Privacy Settings Modal - New style */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showPrivacySettingsModal}
        onRequestClose={() => setShowPrivacySettingsModal(false)}
      >
        <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
          <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-3/4`}>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                Privacy Settings
              </CustomText>
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                onPress={() => setShowPrivacySettingsModal(false)}
              >
                <FontAwesome name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                <CustomText weight="semibold" style={twrnc`text-white mb-4`}>
                  Profile Visibility
                </CustomText>

                <TouchableOpacity
                  style={twrnc`flex-row items-center justify-between mb-4`}
                  onPress={() => togglePrivacySetting("showProfile")}
                >
                  <View>
                    <CustomText style={twrnc`text-white mb-1`}>Show Profile to Others</CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>
                      Allow other users to view your profile information
                    </CustomText>
                  </View>
                  <View
                    style={twrnc`w-12 h-6 rounded-full ${
                      userData.privacySettings.showProfile ? "bg-green-500" : "bg-gray-600"
                    } items-center justify-center`}
                  >
                    <View
                      style={twrnc`absolute ${
                        userData.privacySettings.showProfile ? "right-1" : "left-1"
                      } w-4 h-4 bg-white rounded-full`}
                    />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={twrnc`flex-row items-center justify-between mb-4`}
                  onPress={() => togglePrivacySetting("showActivities")}
                >
                  <View>
                    <CustomText style={twrnc`text-white mb-1`}>Show Activities to Others</CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>
                      Allow other users to see your activity history
                    </CustomText>
                  </View>
                  <View
                    style={twrnc`w-12 h-6 rounded-full ${
                      userData.privacySettings.showActivities ? "bg-green-500" : "bg-gray-600"
                    } items-center justify-center`}
                  >
                    <View
                      style={twrnc`absolute ${
                        userData.privacySettings.showActivities ? "right-1" : "left-1"
                      } w-4 h-4 bg-white rounded-full`}
                    />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={twrnc`flex-row items-center justify-between mb-4`}
                  onPress={() => togglePrivacySetting("showStats")}
                >
                  <View>
                    <CustomText style={twrnc`text-white mb-1`}>Show Stats to Others</CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>
                      Allow other users to view your fitness statistics
                    </CustomText>
                  </View>
                  <View
                    style={twrnc`w-12 h-6 rounded-full ${
                      userData.privacySettings.showStats ? "bg-green-500" : "bg-gray-600"
                    } items-center justify-center`}
                  >
                    <View
                      style={twrnc`absolute ${
                        userData.privacySettings.showStats ? "right-1" : "left-1"
                      } w-4 h-4 bg-white rounded-full`}
                    />
                  </View>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={twrnc`bg-[#9C27B0] p-3 rounded-lg items-center mb-4`}
                onPress={savePrivacySettings}
                disabled={savingPrivacySettings}
              >
                {savingPrivacySettings ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <CustomText weight="semibold" style={twrnc`text-white`}>
                    Save Privacy Settings
                  </CustomText>
                )}
              </TouchableOpacity>

              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                <CustomText weight="semibold" style={twrnc`text-white mb-2`}>
                  Data & Privacy
                </CustomText>
                <CustomText style={twrnc`text-gray-400 mb-4`}>
                  We value your privacy. Your data is stored securely and is only used to provide you with the best
                  experience.
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#3A3F4B] p-3 rounded-lg items-center mb-2`}
                  onPress={() => Alert.alert("Privacy Policy", "The privacy policy will open in your browser.")}
                >
                  <CustomText style={twrnc`text-white`}>View Privacy Policy</CustomText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`bg-[#3A3F4B] p-3 rounded-lg items-center`}
                  onPress={() =>
                    Alert.alert("Data Request", "You can request a copy of your data by contacting support.")
                  }
                >
                  <CustomText style={twrnc`text-white`}>Request My Data</CustomText>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

export default ProfileScreen
