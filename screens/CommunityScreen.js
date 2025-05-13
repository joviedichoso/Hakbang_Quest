"use client"

import { useState, useEffect, useCallback } from "react"
import {
  View,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
  RefreshControl,
  TextInput,
  FlatList,
  Dimensions,
  Alert,
} from "react-native"
import twrnc from "twrnc"
import CustomText from "../components/CustomText"
import { FontAwesome } from "@expo/vector-icons"
import { Feather } from "@expo/vector-icons"
import { Ionicons } from "@expo/vector-icons"
import { MaterialCommunityIcons } from "@expo/vector-icons"
import {
  getDocs,
  collection,
  query,
  where,
  doc,
  updateDoc,
  arrayUnion,
  getDoc,
  addDoc,
  serverTimestamp,
  limit,
} from "firebase/firestore"
import { db, auth } from "../firebaseConfig"

// Helper functions
const formatLastActive = (timestamp) => {
  if (!timestamp) return "Never active"

  const now = new Date()
  const lastActive = timestamp.toDate()
  const diffMs = now - lastActive
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? "" : "s"} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`

  return lastActive.toLocaleDateString()
}

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`
}

const CommunityScreen = ({ navigateToDashboard, navigation }) => {
  const [activeTab, setActiveTab] = useState("friends")
  const [searchQuery, setSearchQuery] = useState("")
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [challenges, setChallenges] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [isAddFriendModalVisible, setIsAddFriendModalVisible] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [userProfile, setUserProfile] = useState(null)
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [isFriendProfileVisible, setIsFriendProfileVisible] = useState(false)

  const { width } = Dimensions.get("window")

  // Fetch user data and friends
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const user = auth.currentUser

      if (!user) {
        setError("Please sign in to view community features")
        setLoading(false)
        return
      }

      // Get current user profile
      const userDoc = await getDoc(doc(db, "users", user.uid))
      if (userDoc.exists()) {
        setUserProfile({
          id: user.uid,
          ...userDoc.data(),
        })
      }

      // Get friends list
      const userFriends = userDoc.data()?.friends || []

      if (userFriends.length > 0) {
        const friendsData = []
        for (const friendId of userFriends) {
          try {
            const friendDoc = await getDoc(doc(db, "users", friendId))
            if (friendDoc.exists()) {
              // Get friend's latest activity
              const activitiesRef = collection(db, "activities")
              const activitiesQuery = query(
                activitiesRef,
                where("userId", "==", friendId),
                where("createdAt", ">=", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // Last 7 days
                limit(10), // Limit to 10 activities for performance
              )
              const activitiesSnapshot = await getDocs(activitiesQuery)
              const activities = activitiesSnapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
              }))

              // Sort activities by date (newest first)
              activities.sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate())

              const lastActivity = activities.length > 0 ? activities[0] : null

              // Calculate streak (consecutive days with activities)
              const streak = calculateStreak(activities)

              friendsData.push({
                id: friendId,
                ...friendDoc.data(),
                lastActivity: lastActivity,
                streak: streak,
                isOnline: Math.random() > 0.5, // Mock online status (replace with real implementation)
              })
            }
          } catch (err) {
            console.warn(`Error fetching friend ${friendId}:`, err)
            // Continue with other friends even if one fails
          }
        }
        setFriends(friendsData)
      }

      // Get friend requests - only those sent to the current user
      try {
        const requestsRef = collection(db, "friendRequests")
        const requestsQuery = query(requestsRef, where("to", "==", user.uid), where("status", "==", "pending"))
        const requestsSnapshot = await getDocs(requestsQuery)

        const requestsData = []
        for (const requestDoc of requestsSnapshot.docs) {
          const requestData = requestDoc.data()
          const fromUserDoc = await getDoc(doc(db, "users", requestData.from))

          if (fromUserDoc.exists()) {
            // Count mutual friends
            const fromUserFriends = fromUserDoc.data()?.friends || []
            const mutualFriends = fromUserFriends.filter((id) => userFriends.includes(id))

            requestsData.push({
              id: requestDoc.id,
              ...requestData,
              fromUser: {
                id: requestData.from,
                ...fromUserDoc.data(),
              },
              mutualFriends: mutualFriends.length,
            })
          }
        }
        setFriendRequests(requestsData)
      } catch (err) {
        console.warn("Error fetching friend requests:", err)
        // Continue with other data even if friend requests fail
      }

      // Get community challenges - simplified to avoid permissions issues
      try {
        // Mock challenges data for now
        // In a real implementation, you would create the challenges collection
        // and set up proper security rules
        setChallenges([
          {
            id: "challenge1",
            title: "10K Challenge",
            description: "Complete a 10K run this week",
            type: "Running",
            participants: 24,
            endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            isPublic: true,
          },
          {
            id: "challenge2",
            title: "Morning Mile",
            description: "Walk a mile every morning for a week",
            type: "Walking",
            participants: 56,
            endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
            isPublic: true,
          },
        ])
      } catch (err) {
        console.warn("Error fetching challenges:", err)
        // Continue with other data even if challenges fail
      }

      // Get leaderboard data - simplified to avoid permissions issues
      try {
        // Create a simple leaderboard based on activities
        const activitiesRef = collection(db, "activities")
        const startOfWeek = new Date()
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
        startOfWeek.setHours(0, 0, 0, 0)

        const activitiesQuery = query(
          activitiesRef,
          where("createdAt", ">=", startOfWeek),
          limit(50), // Limit to 50 activities for performance
        )
        const activitiesSnapshot = await getDocs(activitiesQuery)

        // Group activities by user
        const userDistances = {}
        const userNames = {}

        for (const activityDoc of activitiesSnapshot.docs) {
          const activityData = activityDoc.data()
          const userId = activityData.userId

          if (!userId) continue

          // Add distance to user's total
          if (!userDistances[userId]) {
            userDistances[userId] = 0

            // Get user name if we don't have it yet
            if (!userNames[userId]) {
              try {
                const userDoc = await getDoc(doc(db, "users", userId))
                if (userDoc.exists()) {
                  userNames[userId] = userDoc.data().displayName || userDoc.data().username || "User"
                }
              } catch (err) {
                userNames[userId] = "User"
              }
            }
          }

          userDistances[userId] += activityData.distance || 0
        }

        // Convert to array and sort
        const leaderboardData = Object.keys(userDistances).map((userId) => ({
          id: userId,
          name: userNames[userId] || "User",
          distance: userDistances[userId],
          isCurrentUser: userId === user.uid,
        }))

        // Sort by distance (highest first)
        leaderboardData.sort((a, b) => b.distance - a.distance)
        setLeaderboard(leaderboardData.slice(0, 10)) // Top 10
      } catch (err) {
        console.warn("Error creating leaderboard:", err)
        // Continue even if leaderboard fails
      }

      setLoading(false)
      setRefreshing(false)
    } catch (err) {
      console.error("Error fetching community data:", err)
      setError(err.message)
      setLoading(false)
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

  // Calculate streak from activities
  const calculateStreak = (activities) => {
    if (!activities || activities.length === 0) return 0

    // Group activities by day
    const activityDays = new Set()
    activities.forEach((activity) => {
      if (activity.createdAt) {
        const date = activity.createdAt.toDate()
        activityDays.add(date.toDateString())
      }
    })

    // Check for consecutive days
    let streak = 0
    const today = new Date()

    for (let i = 0; i < 30; i++) {
      // Check up to 30 days back
      const checkDate = new Date()
      checkDate.setDate(today.getDate() - i)

      if (activityDays.has(checkDate.toDateString())) {
        streak++
      } else if (streak > 0) {
        // Break on first day without activity after streak starts
        break
      }
    }

    return streak
  }

  // Search for users
  const searchUsers = async (query) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    try {
      setSearchLoading(true)
      const user = auth.currentUser

      // Get current user's friends
      const userDoc = await getDoc(doc(db, "users", user.uid))
      const userFriends = userDoc.data()?.friends || []

      // Search users by displayName or username
      // Note: This is a simplified approach. In a real app, you'd want to use
      // a more efficient search method like Firebase's array-contains queries
      // or a dedicated search service like Algolia
      const usersRef = collection(db, "users")
      const usersSnapshot = await getDocs(usersRef)

      const results = []
      for (const userDoc of usersSnapshot.docs) {
        // Skip current user
        if (userDoc.id === user.uid) continue

        const userData = userDoc.data()
        const displayName = userData.displayName || ""
        const username = userData.username || ""

        // Check if name or username contains search query
        if (
          displayName.toLowerCase().includes(query.toLowerCase()) ||
          username.toLowerCase().includes(query.toLowerCase())
        ) {
          // Check if already friends
          const isFriend = userFriends.includes(userDoc.id)

          // Check if friend request already sent
          let requestSent = false
          try {
            const requestsRef = collection(db, "friendRequests")
            const sentRequestQuery = query(
              requestsRef,
              where("from", "==", user.uid),
              where("to", "==", userDoc.id),
              where("status", "==", "pending"),
            )
            const sentRequestSnapshot = await getDocs(sentRequestQuery)
            requestSent = !sentRequestSnapshot.empty
          } catch (err) {
            console.warn("Error checking friend request status:", err)
          }

          results.push({
            id: userDoc.id,
            ...userData,
            isFriend,
            requestSent,
          })
        }
      }

      setSearchResults(results)
      setSearchLoading(false)
    } catch (err) {
      console.error("Error searching users:", err)
      setSearchLoading(false)
      Alert.alert("Search Error", "There was a problem searching for users. Please try again.")
    }
  }

  // Send friend request
  const sendFriendRequest = async (userId) => {
    try {
      const user = auth.currentUser

      // Add friend request to database
      const requestsRef = collection(db, "friendRequests")
      await addDoc(requestsRef, {
        from: user.uid,
        to: userId,
        status: "pending",
        createdAt: serverTimestamp(),
      })

      // Update search results to show request sent
      setSearchResults((prevResults) =>
        prevResults.map((result) => (result.id === userId ? { ...result, requestSent: true } : result)),
      )

      Alert.alert("Success", "Friend request sent successfully!")
    } catch (err) {
      console.error("Error sending friend request:", err)
      Alert.alert("Error", "Failed to send friend request. Please try again.")
    }
  }

  // Accept friend request
  const acceptFriendRequest = async (requestId, fromUserId) => {
    try {
      const user = auth.currentUser

      // Update request status
      const requestRef = doc(db, "friendRequests", requestId)
      await updateDoc(requestRef, {
        status: "accepted",
        updatedAt: serverTimestamp(),
      })

      // Add each user to the other's friends list
      const currentUserRef = doc(db, "users", user.uid)
      await updateDoc(currentUserRef, {
        friends: arrayUnion(fromUserId),
      })

      // This might fail due to security rules if the user can't update other users' documents
      try {
        const fromUserRef = doc(db, "users", fromUserId)
        await updateDoc(fromUserRef, {
          friends: arrayUnion(user.uid),
        })
      } catch (err) {
        console.warn("Could not update friend's document:", err)
        // Consider using a Cloud Function to handle this part securely
        Alert.alert(
          "Partial Success",
          "Friend request accepted, but there was an issue updating your friend's list. They may need to accept your request as well.",
        )
      }

      // Refresh data
      fetchData()
    } catch (err) {
      console.error("Error accepting friend request:", err)
      Alert.alert("Error", "Failed to accept friend request. Please try again.")
    }
  }

  // Reject friend request
  const rejectFriendRequest = async (requestId) => {
    try {
      // Update request status
      const requestRef = doc(db, "friendRequests", requestId)
      await updateDoc(requestRef, {
        status: "rejected",
        updatedAt: serverTimestamp(),
      })

      // Refresh data
      fetchData()
    } catch (err) {
      console.error("Error rejecting friend request:", err)
      Alert.alert("Error", "Failed to reject friend request. Please try again.")
    }
  }

  // Join challenge
  const joinChallenge = async (challengeId) => {
    try {
      const user = auth.currentUser

      // In a real implementation, you would update the challenge document
      // For now, just show a success message
      Alert.alert("Success", "You've joined the challenge!")

      // Refresh data
      fetchData()
    } catch (err) {
      console.error("Error joining challenge:", err)
      Alert.alert("Error", "Failed to join challenge. Please try again.")
    }
  }

  // View friend profile
  const viewFriendProfile = (friend) => {
    setSelectedFriend(friend)
    setIsFriendProfileVisible(true)
  }

  // Format activity description
  const formatActivityDescription = (activity) => {
    if (!activity) return "No recent activity"

    const activityType = activity.activityType || "activity"
    const distance = activity.distance ? `${activity.distance.toFixed(2)} km` : ""
    const timeAgo = activity.createdAt ? formatLastActive(activity.createdAt) : ""

    return `${activityType.charAt(0).toUpperCase() + activityType.slice(1)} ${distance} • ${timeAgo}`
  }

  // Render friend item
  const renderFriendItem = ({ item }) => (
    <TouchableOpacity
      style={twrnc`flex-row items-center p-4 bg-[#2A2E3A] rounded-xl mb-3`}
      onPress={() => viewFriendProfile(item)}
    >
      <Image
        style={twrnc`w-12 h-12 rounded-full bg-gray-700`}
      />
      <View style={twrnc`ml-3 flex-1`}>
        <View style={twrnc`flex-row items-center`}>
          <CustomText weight="semibold" style={twrnc`text-white text-base`}>
            {item.displayName || item.username || "User"}
          </CustomText>
          <View style={twrnc`ml-2 w-2 h-2 rounded-full ${item.isOnline ? "bg-green-500" : "bg-gray-500"}`} />
          <View style={twrnc`ml-auto flex-row items-center`}>
            <MaterialCommunityIcons name="fire" size={16} color="#FFC107" />
            <CustomText style={twrnc`text-[#FFC107] font-bold ml-1`}>{item.streak || 0}</CustomText>
          </View>
        </View>
        <CustomText style={twrnc`text-gray-400 text-sm mt-1`}>
          {formatActivityDescription(item.lastActivity)}
        </CustomText>
      </View>
    </TouchableOpacity>
  )

  // Render friend request item
  const renderRequestItem = ({ item }) => (
    <View style={twrnc`flex-row items-center p-4 bg-[#2A2E3A] rounded-xl mb-3`}>
      <Image
        style={twrnc`w-12 h-12 rounded-full bg-gray-700`}
      />
      <View style={twrnc`ml-3 flex-1`}>
        <CustomText weight="semibold" style={twrnc`text-white`}>
          {item.fromUser.displayName || item.fromUser.username || "User"}
        </CustomText>
        <CustomText style={twrnc`text-gray-400 text-xs mt-1`}>
          {item.mutualFriends > 0
            ? `${item.mutualFriends} mutual friend${item.mutualFriends > 1 ? "s" : ""}`
            : "No mutual friends"}
        </CustomText>
      </View>
      <View style={twrnc`flex-row`}>
        <TouchableOpacity
          style={twrnc`bg-[#4CAF50] p-2 rounded-full mr-2`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => acceptFriendRequest(item.id, item.fromUser.id)}
        >
          <Feather name="check" size={18} color="white" />
        </TouchableOpacity>
        <TouchableOpacity
          style={twrnc`bg-[#F44336] p-2 rounded-full`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => rejectFriendRequest(item.id)}
        >
          <Feather name="x" size={18} color="white" />
        </TouchableOpacity>
      </View>
    </View>
  )

  // Render challenge item
  const renderChallengeItem = ({ item }) => (
    <TouchableOpacity style={twrnc`flex-row items-center p-4 bg-[#2A2E3A] rounded-xl mb-3`}>
      <View style={twrnc`w-16 h-16 rounded-lg bg-[#4361EE] items-center justify-center`}>
        {item.icon ? (
          <Image source={{ uri: item.icon }} style={twrnc`w-10 h-10`} resizeMode="contain" />
        ) : (
          <FontAwesome name="trophy" size={28} color="#FFC107" />
        )}
      </View>
      <View style={twrnc`ml-3 flex-1`}>
        <CustomText weight="semibold" style={twrnc`text-white text-base`}>
          {item.title}
        </CustomText>
        <View style={twrnc`flex-row items-center mt-1`}>
          <CustomText style={twrnc`text-gray-400 text-xs`}>{item.type || "Challenge"}</CustomText>
          <CustomText style={twrnc`text-gray-400 text-xs mx-2`}>•</CustomText>
          <CustomText style={twrnc`text-gray-400 text-xs`}>
            {item.participants} participant{item.participants !== 1 ? "s" : ""}
          </CustomText>
        </View>
        <View style={twrnc`flex-row items-center mt-1`}>
          <Ionicons name="time-outline" size={14} color="#FFC107" />
          <CustomText style={twrnc`text-[#FFC107] text-xs ml-1`}>
            {item.endDate ? `Ends ${new Date(item.endDate).toLocaleDateString()}` : "Ongoing"}
          </CustomText>
        </View>
      </View>
      <TouchableOpacity style={twrnc`bg-[#4361EE] py-2 px-4 rounded-full`} onPress={() => joinChallenge(item.id)}>
        <CustomText weight="medium" style={twrnc`text-white text-sm`}>
          Join
        </CustomText>
      </TouchableOpacity>
    </TouchableOpacity>
  )

  // Render search result item
  const renderSearchResultItem = ({ item }) => (
    <View style={twrnc`flex-row items-center p-4 bg-[#2A2E3A] rounded-xl mb-3`}>
      <Image
        style={twrnc`w-12 h-12 rounded-full bg-gray-700`}
      />
      <View style={twrnc`ml-3 flex-1`}>
        <CustomText weight="semibold" style={twrnc`text-white`}>
          {item.displayName || item.username || "User"}
        </CustomText>
        <CustomText style={twrnc`text-gray-400 text-xs mt-1`}>
          {item.bio ? item.bio.substring(0, 30) + (item.bio.length > 30 ? "..." : "") : "No bio"}
        </CustomText>
      </View>
      {item.isFriend ? (
        <View style={twrnc`bg-gray-600 py-2 px-4 rounded-full`}>
          <CustomText style={twrnc`text-white text-sm`}>Friends</CustomText>
        </View>
      ) : item.requestSent ? (
        <View style={twrnc`bg-[#FFC107] py-2 px-4 rounded-full`}>
          <CustomText style={twrnc`text-[#121826] text-sm font-medium`}>Pending</CustomText>
        </View>
      ) : (
        <TouchableOpacity style={twrnc`bg-[#4361EE] py-2 px-4 rounded-full`} onPress={() => sendFriendRequest(item.id)}>
          <CustomText weight="medium" style={twrnc`text-white text-sm`}>
            Add
          </CustomText>
        </TouchableOpacity>
      )}
    </View>
  )

  if (loading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <CustomText style={twrnc`text-white mt-4`}>Loading Community...</CustomText>
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
      {/* Header with Back Button */}
      <View style={twrnc`flex-row items-center p-4 bg-[#121826] border-b border-[#2A3447]`}>
        {/* Back Button on the left */}
        <TouchableOpacity
          onPress={navigateToDashboard}
          style={twrnc`mr-4`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <FontAwesome name="angle-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Title on the left */}
        <View style={twrnc`flex-1`}>
          <CustomText weight="bold" style={twrnc`text-white text-center text-lg`}>
            Community
          </CustomText>
        </View>

        {/* Add Friend Button on the right */}
        <TouchableOpacity
          style={twrnc`ml-auto bg-[#4361EE] p-2 rounded-full`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => setIsAddFriendModalVisible(true)}
        >
          <Ionicons name="person-add" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={twrnc`px-4 pt-4 pb-2`}>
        <View style={twrnc`flex-row items-center bg-[#2A2E3A] rounded-full px-4 py-2`}>
          <Ionicons name="search" size={20} color="#6B7280" />
          <TextInput
            style={twrnc`flex-1 text-white ml-2 h-10`}
            placeholder="Search friends or challenges..."
            placeholderTextColor="#6B7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={20} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={twrnc`flex-row px-4 pt-2 border-b border-[#2A3447]`}>
        <TouchableOpacity
          style={twrnc`mr-6 pb-2 ${activeTab === "friends" ? "border-b-2 border-[#4361EE]" : ""}`}
          onPress={() => setActiveTab("friends")}
        >
          <CustomText
            weight={activeTab === "friends" ? "semibold" : "normal"}
            style={twrnc`text-${activeTab === "friends" ? "white" : "gray-400"}`}
          >
            Friends
          </CustomText>
        </TouchableOpacity>
        <TouchableOpacity
          style={twrnc`mr-6 pb-2 ${activeTab === "requests" ? "border-b-2 border-[#4361EE]" : ""}`}
          onPress={() => setActiveTab("requests")}
        >
          <View style={twrnc`flex-row items-center`}>
            <CustomText
              weight={activeTab === "requests" ? "semibold" : "normal"}
              style={twrnc`text-${activeTab === "requests" ? "white" : "gray-400"}`}
            >
              Requests
            </CustomText>
            {friendRequests.length > 0 && (
              <View style={twrnc`ml-1 bg-[#4361EE] rounded-full w-5 h-5 items-center justify-center`}>
                <CustomText style={twrnc`text-white text-xs font-bold`}>{friendRequests.length}</CustomText>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={twrnc`mr-6 pb-2 ${activeTab === "challenges" ? "border-b-2 border-[#4361EE]" : ""}`}
          onPress={() => setActiveTab("challenges")}
        >
          <CustomText
            weight={activeTab === "challenges" ? "semibold" : "normal"}
            style={twrnc`text-${activeTab === "challenges" ? "white" : "gray-400"}`}
          >
            Challenges
          </CustomText>
        </TouchableOpacity>
        <TouchableOpacity
          style={twrnc`pb-2 ${activeTab === "leaderboard" ? "border-b-2 border-[#4361EE]" : ""}`}
          onPress={() => setActiveTab("leaderboard")}
        >
          <CustomText
            weight={activeTab === "leaderboard" ? "semibold" : "normal"}
            style={twrnc`text-${activeTab === "leaderboard" ? "white" : "gray-400"}`}
          >
            Leaderboard
          </CustomText>
        </TouchableOpacity>
      </View>

      {/* Content based on active tab */}
      <ScrollView
        style={twrnc`flex-1 px-4 pt-4`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
            colors={["#4361EE", "#FFC107"]}
          />
        }
      >
        {activeTab === "friends" && (
          <>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="semibold" style={twrnc`text-white`}>
                Your Friends ({friends.length})
              </CustomText>
              <TouchableOpacity onPress={() => setIsAddFriendModalVisible(true)}>
                <CustomText style={twrnc`text-[#4361EE]`}>Add New</CustomText>
              </TouchableOpacity>
            </View>

            {friends.length > 0 ? (
              <FlatList
                data={friends}
                renderItem={renderFriendItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            ) : (
              <View style={twrnc`items-center justify-center py-8 bg-[#2A2E3A] rounded-xl`}>
                <MaterialCommunityIcons name="account-group" size={48} color="#4361EE" />
                <CustomText style={twrnc`text-white text-center mt-4 mb-2`}>No friends yet</CustomText>
                <CustomText style={twrnc`text-gray-400 text-center mb-4 px-6`}>
                  Add friends to see their activities and challenge them
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#4361EE] py-2 px-6 rounded-full`}
                  onPress={() => setIsAddFriendModalVisible(true)}
                >
                  <CustomText weight="medium" style={twrnc`text-white`}>
                    Find Friends
                  </CustomText>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {activeTab === "requests" && (
          <>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="semibold" style={twrnc`text-white`}>
                Friend Requests ({friendRequests.length})
              </CustomText>
            </View>

            {friendRequests.length > 0 ? (
              <FlatList
                data={friendRequests}
                renderItem={renderRequestItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            ) : (
              <View style={twrnc`items-center justify-center py-8 bg-[#2A2E3A] rounded-xl`}>
                <MaterialCommunityIcons name="account-multiple" size={48} color="#4361EE" />
                <CustomText style={twrnc`text-white text-center mt-4`}>No friend requests at the moment</CustomText>
              </View>
            )}
          </>
        )}

        {activeTab === "challenges" && (
          <>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="semibold" style={twrnc`text-white`}>
                Community Challenges
              </CustomText>
              <TouchableOpacity>
                <CustomText style={twrnc`text-[#4361EE]`}>Create New</CustomText>
              </TouchableOpacity>
            </View>

            {challenges.length > 0 ? (
              <FlatList
                data={challenges}
                renderItem={renderChallengeItem}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            ) : (
              <View style={twrnc`items-center justify-center py-8 bg-[#2A2E3A] rounded-xl`}>
                <FontAwesome name="trophy" size={48} color="#FFC107" />
                <CustomText style={twrnc`text-white text-center mt-4 mb-2`}>
                  No community challenges available
                </CustomText>
                <CustomText style={twrnc`text-gray-400 text-center mb-4 px-6`}>
                  Create a challenge and invite your friends to join
                </CustomText>
                <TouchableOpacity style={twrnc`bg-[#4361EE] py-2 px-6 rounded-full`}>
                  <CustomText weight="medium" style={twrnc`text-white`}>
                    Create Challenge
                  </CustomText>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {activeTab === "leaderboard" && (
          <>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="semibold" style={twrnc`text-white`}>
                Weekly Distance Leaderboard
              </CustomText>
              <TouchableOpacity>
                <CustomText style={twrnc`text-[#4361EE]`}>View All</CustomText>
              </TouchableOpacity>
            </View>

            <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4`}>
              {leaderboard.length > 0 ? (
                leaderboard.map((user, index) => (
                  <View
                    key={user.id}
                    style={twrnc`flex-row items-center mb-${index < leaderboard.length - 1 ? "4" : "0"}`}
                  >
                    <View
                      style={twrnc`w-8 h-8 rounded-full ${index === 0
                        ? "bg-[#FFD700]"
                        : index === 1
                          ? "bg-[#C0C0C0]"
                          : index === 2
                            ? "bg-[#CD7F32]"
                            : "bg-[#2A2E3A] border border-gray-600"
                        } items-center justify-center`}
                    >
                      <CustomText weight="bold" style={twrnc`${index < 3 ? "text-[#121826]" : "text-gray-400"}`}>
                        {index + 1}
                      </CustomText>
                    </View>
                    <Image
                      style={twrnc`w-10 h-10 rounded-full ml-3 bg-gray-700`}
                    />
                    <View style={twrnc`ml-3 flex-1`}>
                      <View style={twrnc`flex-row items-center`}>
                        <CustomText weight={user.isCurrentUser ? "bold" : "medium"} style={twrnc`text-white`}>
                          {user.isCurrentUser ? "You" : user.name}
                        </CustomText>
                        {user.isCurrentUser && (
                          <View style={twrnc`ml-2 bg-[#4361EE] rounded-full px-2 py-0.5`}>
                            <CustomText style={twrnc`text-white text-xs`}>You</CustomText>
                          </View>
                        )}
                      </View>
                    </View>
                    <CustomText weight="bold" style={twrnc`text-white`}>
                      {user.distance.toFixed(1)} km
                    </CustomText>
                  </View>
                ))
              ) : (
                <View style={twrnc`items-center justify-center py-6`}>
                  <FontAwesome name="trophy" size={36} color="#FFC107" />
                  <CustomText style={twrnc`text-white text-center mt-4`}>No leaderboard data yet</CustomText>
                  <CustomText style={twrnc`text-gray-400 text-center mt-2`}>
                    Complete activities to appear on the leaderboard
                  </CustomText>
                </View>
              )}
            </View>

            {/* Activity Stats */}
            <View style={twrnc`mt-6 mb-4`}>
              <CustomText weight="semibold" style={twrnc`text-white mb-4`}>
                Activity Stats
              </CustomText>

              <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4`}>
                <View style={twrnc`flex-row justify-between mb-4`}>
                  <View style={twrnc`items-center`}>
                    <CustomText weight="bold" style={twrnc`text-[#FFC107] text-xl`}>
                      {friends.length}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>Friends</CustomText>
                  </View>
                  <View style={twrnc`items-center`}>
                    <CustomText weight="bold" style={twrnc`text-[#FFC107] text-xl`}>
                      {challenges.length}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>Challenges</CustomText>
                  </View>
                  <View style={twrnc`items-center`}>
                    <CustomText weight="bold" style={twrnc`text-[#FFC107] text-xl`}>
                      {leaderboard.findIndex((user) => user.isCurrentUser) + 1 || "-"}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>Rank</CustomText>
                  </View>
                </View>

                <TouchableOpacity style={twrnc`bg-[#4361EE] bg-opacity-20 rounded-lg p-3 items-center`}>
                  <CustomText style={twrnc`text-[#4361EE] font-medium`}>View Your Profile</CustomText>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Add Friend Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isAddFriendModalVisible}
        onRequestClose={() => setIsAddFriendModalVisible(false)}
      >
        <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
          <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-3/4`}>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                Find Friends
              </CustomText>
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                onPress={() => setIsAddFriendModalVisible(false)}
              >
                <FontAwesome name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={twrnc`flex-row items-center bg-[#2A2E3A] rounded-full px-4 py-2 mb-4`}>
              <Ionicons name="search" size={20} color="#6B7280" />
              <TextInput
                style={twrnc`flex-1 text-white ml-2 h-10`}
                placeholder="Search by name or username..."
                placeholderTextColor="#6B7280"
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text)
                  searchUsers(text)
                }}
                autoFocus={true}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setSearchQuery("")
                    setSearchResults([])
                  }}
                >
                  <Ionicons name="close-circle" size={20} color="#6B7280" />
                </TouchableOpacity>
              )}
            </View>

            {searchLoading ? (
              <View style={twrnc`items-center justify-center py-8`}>
                <ActivityIndicator size="large" color="#4361EE" />
                <CustomText style={twrnc`text-white mt-4`}>Searching...</CustomText>
              </View>
            ) : searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                renderItem={renderSearchResultItem}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
              />
            ) : searchQuery.length > 0 ? (
              <View style={twrnc`items-center justify-center py-8`}>
                <FontAwesome name="search" size={40} color="#6B7280" />
                <CustomText style={twrnc`text-white text-center mt-4`}>
                  No users found matching "{searchQuery}"
                </CustomText>
              </View>
            ) : (
              <View style={twrnc`items-center justify-center py-8`}>
                <MaterialCommunityIcons name="account-search" size={48} color="#4361EE" />
                <CustomText style={twrnc`text-white text-center mt-4 mb-2`}>Search for friends</CustomText>
                <CustomText style={twrnc`text-gray-400 text-center px-6`}>
                  Find friends by searching their name or username
                </CustomText>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Friend Profile Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isFriendProfileVisible}
        onRequestClose={() => setIsFriendProfileVisible(false)}
      >
        {selectedFriend && (
          <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
            <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-3/4`}>
              <View style={twrnc`flex-row justify-between items-center mb-4`}>
                <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                  Friend Profile
                </CustomText>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                  onPress={() => setIsFriendProfileVisible(false)}
                >
                  <FontAwesome name="close" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <View style={twrnc`items-center mb-6`}>
                <Image
                  style={twrnc`w-24 h-24 rounded-full bg-gray-700 mb-3`}
                />
                <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                  {selectedFriend.displayName || selectedFriend.username || "User"}
                </CustomText>
                <View style={twrnc`flex-row items-center mt-1`}>
                  <View
                    style={twrnc`w-2 h-2 rounded-full ${selectedFriend.isOnline ? "bg-green-500" : "bg-gray-500"} mr-2`}
                  />
                  <CustomText style={twrnc`text-gray-400`}>{selectedFriend.isOnline ? "Online" : "Offline"}</CustomText>
                </View>
              </View>

              <View style={twrnc`flex-row justify-between bg-[#2A2E3A] rounded-xl p-4 mb-5`}>
                <View style={twrnc`items-center flex-1`}>
                  <CustomText weight="bold" style={twrnc`text-[#FFC107] text-lg`}>
                    {selectedFriend.streak || 0}
                  </CustomText>
                  <CustomText style={twrnc`text-gray-400 text-xs`}>Day Streak</CustomText>
                </View>
                <View style={twrnc`items-center flex-1 border-l border-r border-[#3A3F4B] px-2`}>
                  <CustomText weight="bold" style={twrnc`text-[#FFC107] text-lg`}>
                    {selectedFriend.totalDistance ? selectedFriend.totalDistance.toFixed(1) : "0"} km
                  </CustomText>
                  <CustomText style={twrnc`text-gray-400 text-xs`}>Total Distance</CustomText>
                </View>
                <View style={twrnc`items-center flex-1`}>
                  <CustomText weight="bold" style={twrnc`text-[#FFC107] text-lg`}>
                    {selectedFriend.totalActivities || 0}
                  </CustomText>
                  <CustomText style={twrnc`text-gray-400 text-xs`}>Activities</CustomText>
                </View>
              </View>

              <CustomText weight="semibold" style={twrnc`text-white mb-3`}>
                Recent Activity
              </CustomText>

              {selectedFriend.lastActivity ? (
                <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}>
                  <View style={twrnc`flex-row items-center mb-2`}>
                    <FontAwesome
                      name={
                        selectedFriend.lastActivity.activityType === "running"
                          ? "running"
                          : selectedFriend.lastActivity.activityType === "cycling"
                            ? "bicycle"
                            : "walking"
                      }
                      size={18}
                      color="#FFC107"
                      style={twrnc`mr-2`}
                    />
                    <CustomText weight="semibold" style={twrnc`text-white`}>
                      {selectedFriend.lastActivity.activityType?.charAt(0).toUpperCase() +
                        selectedFriend.lastActivity.activityType?.slice(1) || "Activity"}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs ml-auto`}>
                      {selectedFriend.lastActivity.createdAt
                        ? formatLastActive(selectedFriend.lastActivity.createdAt)
                        : ""}
                    </CustomText>
                  </View>

                  <View style={twrnc`flex-row justify-between mt-2`}>
                    <View style={twrnc`items-center`}>
                      <CustomText weight="semibold" style={twrnc`text-[#FFC107]`}>
                        {selectedFriend.lastActivity.distance
                          ? selectedFriend.lastActivity.distance.toFixed(2) + " km"
                          : "0 km"}
                      </CustomText>
                      <CustomText style={twrnc`text-gray-400 text-xs`}>Distance</CustomText>
                    </View>
                    <View style={twrnc`items-center`}>
                      <CustomText weight="semibold" style={twrnc`text-[#FFC107]`}>
                        {selectedFriend.lastActivity.duration
                          ? formatTime(selectedFriend.lastActivity.duration)
                          : "0:00"}
                      </CustomText>
                      <CustomText style={twrnc`text-gray-400 text-xs`}>Duration</CustomText>
                    </View>
                    <View style={twrnc`items-center`}>
                      <CustomText weight="semibold" style={twrnc`text-[#FFC107]`}>
                        {selectedFriend.lastActivity.pace
                          ? formatTime(selectedFriend.lastActivity.pace) + "/km"
                          : "0:00/km"}
                      </CustomText>
                      <CustomText style={twrnc`text-gray-400 text-xs`}>Pace</CustomText>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={twrnc`bg-[#2A2E3A] rounded-xl p-6 items-center justify-center`}>
                  <FontAwesome name="map-o" size={32} color="#6B7280" />
                  <CustomText style={twrnc`text-white text-center mt-3`}>No recent activity</CustomText>
                </View>
              )}

              <View style={twrnc`flex-row justify-between mt-2`}>
                <TouchableOpacity
                  style={twrnc`bg-[#4361EE] rounded-xl py-3 px-4 flex-1 mr-2 items-center`}
                  onPress={() => {
                    setIsFriendProfileVisible(false)
                    Alert.alert(
                      "Challenge Sent",
                      `Challenge sent to ${selectedFriend.displayName || selectedFriend.username || "User"}!`,
                    )
                  }}
                >
                  <CustomText weight="semibold" style={twrnc`text-white`}>
                    Challenge Friend
                  </CustomText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] rounded-xl py-3 px-4 flex-1 ml-2 items-center`}
                  onPress={() => {
                    setIsFriendProfileVisible(false)
                    Alert.alert("Coming Soon", "Messaging feature will be available in the next update!")
                  }}
                >
                  <CustomText weight="semibold" style={twrnc`text-white`}>
                    Message
                  </CustomText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </View>
  )
}

export default CommunityScreen
