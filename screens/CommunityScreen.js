"use client"

import { useState, useEffect, useCallback, useRef } from "react"
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
  KeyboardAvoidingView,
  Platform,
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
  orderBy,
  setDoc,
  onSnapshot,
  Timestamp,
  documentId,
  writeBatch,
} from "firebase/firestore"
import { db, auth } from "../firebaseConfig"
import AsyncStorage from "@react-native-async-storage/async-storage"
import CustomModal from "../components/CustomModal"

// Default avatar image to use when user has no avatar
const DEFAULT_AVATAR = "https://res.cloudinary.com/dljywnlvh/image/upload/v1747077348/default-avatar_jkbpwv.jpg"

// Cache TTL in milliseconds (30 minutes)
const CACHE_TTL = 30 * 60 * 1000

// Helper functions
const formatLastActive = (timestamp) => {
  if (!timestamp) return "Never active"

  const now = new Date()
  const lastActive = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
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

// Cache helper functions
const getCachedData = async (key) => {
  try {
    const cachedData = await AsyncStorage.getItem(key)
    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData)
      // Check if cache is still valid
      if (Date.now() - timestamp < CACHE_TTL) {
        return data
      }
    }
    return null
  } catch (error) {
    console.warn("Error reading from cache:", error)
    return null
  }
}

const setCachedData = async (key, data) => {
  try {
    const cacheItem = {
      data,
      timestamp: Date.now(),
    }
    await AsyncStorage.getItem(key)
    await AsyncStorage.setItem(key, JSON.stringify(cacheItem))
  } catch (error) {
    console.warn("Error writing to cache:", error)
  }
}

// Debounce function
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
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
  const [isCreateChallengeModalVisible, setIsCreateChallengeModalVisible] = useState(false)
  const [isChatModalVisible, setIsChatModalVisible] = useState(false)
  const [chatMessage, setChatMessage] = useState("")
  const [chatMessages, setChatMessages] = useState([])
  const [chatLoading, setChatLoading] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState({})
  const [newChallenge, setNewChallenge] = useState({
    title: "",
    description: "",
    type: "Walking",
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  })
  const [friendsPage, setFriendsPage] = useState(1)
  const [hasMoreFriends, setHasMoreFriends] = useState(true)
  const [loadingMoreFriends, setLoadingMoreFriends] = useState(false)
  const [friendActivitiesCache, setFriendActivitiesCache] = useState({})
  const [offlineMode, setOfflineMode] = useState(false)
  const [lastOnlineSync, setLastOnlineSync] = useState(null)

  // Add these new state variables near the top of the component with the other state declarations
  const [sendingFriendRequests, setSendingFriendRequests] = useState({})
  const [processingRequests, setProcessingRequests] = useState({})
  const [joiningChallenges, setJoiningChallenges] = useState({})
  const [initialLoadComplete, setInitialLoadComplete] = useState(false)
  const [creatingChallenge, setCreatingChallenge] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [sendingChallenge, setSendingChallenge] = useState(false)
  const [openingChat, setOpeningChat] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [modalProps, setModalProps] = useState({
    title: "",
    message: "",
    type: "success",
    confirmText: "OK",
    showCancelButton: false,
    onConfirm: () => setModalVisible(false),
    onCancel: () => setModalVisible(false),
  })

  // Helper to show modal
  const showModal = ({
    title = "Notice",
    message = "",
    type = "info",
    confirmText = "OK",
    showCancelButton = false,
    onConfirm,
    onCancel,
  }) => {
    setModalProps({
      title,
      message,
      type,
      confirmText,
      showCancelButton,
      onConfirm: onConfirm || (() => setModalVisible(false)),
      onCancel: onCancel || (() => setModalVisible(false)),
    })
    setModalVisible(true)
  }

  // Debounced search query
  const debouncedSearchQuery = useDebounce(searchQuery, 500)

  // Refs for unsubscribing from listeners
  const unsubscribersRef = useRef([])
  const chatScrollRef = useRef(null)
  const { width } = Dimensions.get("window")
  const lastOnlineUpdateRef = useRef(0)
  const friendsPerPage = 5 // Number of friends to load per page

  // OPTIMIZATION 1: Reduced online presence updates
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return

    // Set up presence in Firestore - only update every 15 minutes to reduce writes
    const setUserOnlineStatus = async () => {
      try {
        const now = Date.now()
        // Only update if it's been more than 15 minutes since last update (increased from 5 minutes)
        if (now - lastOnlineUpdateRef.current > 15 * 60 * 1000) {
          const userRef = doc(db, "users", user.uid)
          await updateDoc(userRef, {
            isOnline: true,
            lastSeen: serverTimestamp(),
          })
          lastOnlineUpdateRef.current = now
        }
      } catch (err) {
        console.warn("Error setting online status:", err)
      }
    }

    // Call the function immediately
    setUserOnlineStatus()

    // Set up interval to update online status every 15 minutes
    const intervalId = setInterval(setUserOnlineStatus, 15 * 60 * 1000)

    // Return proper cleanup function
    return () => {
      clearInterval(intervalId)
      const userRef = doc(db, "users", user.uid)
      updateDoc(userRef, {
        isOnline: false,
        lastSeen: serverTimestamp(),
      }).catch((err) => console.warn("Error updating offline status:", err))
    }
  }, [])

  // OPTIMIZATION 2: Load user profile and friends with pagination
  useEffect(() => {
    const loadUserProfile = async () => {
      const user = auth.currentUser
      if (!user) return

      setLoading(true)
      setError(null)

      try {
        // Clean up previous listeners
        unsubscribersRef.current.forEach((unsub) => unsub())
        unsubscribersRef.current = []

        // Try to get user profile from cache first
        const cachedProfile = await getCachedData(`userProfile_${user.uid}`)
        if (cachedProfile) {
          setUserProfile(cachedProfile)
          // Load initial friends even if we have cached profile
          loadInitialFriends(cachedProfile.friends || [])
        }

        // Get current user profile - SINGLE LISTENER
        const userDocRef = doc(db, "users", user.uid)
        const userListener = onSnapshot(
          userDocRef,
          async (docSnapshot) => {
            try {
              if (docSnapshot.exists()) {
                const userData = docSnapshot.data()
                const profileData = { id: user.uid, ...userData }
                setUserProfile(profileData)

                // Cache the user profile
                await setCachedData(`userProfile_${user.uid}`, profileData)

                // Load initial friends
                loadInitialFriends(userData.friends || [])
              } else {
                const newUserData = {
                  username: user.displayName || user.email.split("@")[0],
                  email: user.email,
                  avatar: DEFAULT_AVATAR,
                  friends: [],
                  createdAt: serverTimestamp(),
                }
                await setDoc(userDocRef, newUserData)
                const profileData = { id: user.uid, ...newUserData }
                setUserProfile(profileData)
                setFriends([])

                // Cache the new user profile
                await setCachedData(`userProfile_${user.uid}`, profileData)
              }
            } catch (err) {
              console.error("Error in user profile listener:", err)
              setError("Failed to load user profile.")
            } finally {
              setLoading(false)
              setInitialLoadComplete(true)
            }
          },
          (error) => {
            console.error("Error in user profile snapshot:", error)
            setError("Failed to load user profile.")
            setLoading(false)
            setInitialLoadComplete(true)
          },
        )

        unsubscribersRef.current.push(userListener)

        // OPTIMIZATION 3: Load friend requests with a more efficient listener
        loadFriendRequests(user.uid)

        // OPTIMIZATION 4: Load challenges with a more efficient approach
        loadChallenges()

        // OPTIMIZATION 5: Load leaderboard data with caching
        loadLeaderboardData()

        setRefreshing(false)
      } catch (err) {
        console.error("Error loading initial data:", err)
        setError("Failed to load data. Please check your connection.")
        setLoading(false)
        setInitialLoadComplete(true)
      }
    }

    loadUserProfile()

    return () => {
      unsubscribersRef.current.forEach((unsub) => unsub())
      unsubscribersRef.current = []
    }
  }, [])

  // OPTIMIZATION 6: Load friends with pagination
  const loadInitialFriends = async (friendIds) => {
    if (!friendIds || friendIds.length === 0) {
      setFriends([])
      setHasMoreFriends(false)
      return
    }

    try {
      // Reset pagination state
      setFriendsPage(1)
      setHasMoreFriends(friendIds.length > friendsPerPage)

      // Get cached friends data
      const cachedFriends = await getCachedData("friends")
      if (cachedFriends) {
        // Filter cached friends to only include current friends
        const validCachedFriends = cachedFriends.filter((friend) => friendIds.includes(friend.id))
        if (validCachedFriends.length > 0) {
          setFriends(validCachedFriends)

          // Still load fresh data in the background
          loadFriendsPage(friendIds, 1, true)
          return
        }
      }

      // Load first page of friends
      await loadFriendsPage(friendIds, 1)
    } catch (err) {
      console.error("Error loading initial friends:", err)
    }
  }

  const loadFriendsPage = async (allFriendIds, page, isBackgroundRefresh = false) => {
    if (!allFriendIds || allFriendIds.length === 0) {
      setFriends([])
      setHasMoreFriends(false)
      return
    }

    if (!isBackgroundRefresh) {
      setLoadingMoreFriends(true)
    }

    try {
      const startIndex = (page - 1) * friendsPerPage
      const endIndex = startIndex + friendsPerPage
      const pageIds = allFriendIds.slice(startIndex, endIndex)

      if (pageIds.length === 0) {
        setHasMoreFriends(false)
        setLoadingMoreFriends(false)
        return
      }

      // OPTIMIZATION: Use a batch get for friends instead of individual gets
      const friendsData = []

      // Split into chunks of 10 for batched gets (Firestore limit)
      const chunks = []
      for (let i = 0; i < pageIds.length; i += 10) {
        chunks.push(pageIds.slice(i, i + 10))
      }

      for (const chunk of chunks) {
        const friendsQuery = query(collection(db, "users"), where(documentId(), "in", chunk))

        const friendsSnapshot = await getDocs(friendsQuery)

        for (const friendDoc of friendsSnapshot.docs) {
          const friendData = {
            id: friendDoc.id,
            ...friendDoc.data(),
            lastActivity: null,
            streak: 0,
            totalDistance: 0,
            totalActivities: 0,
            isOnline: friendDoc.data().isOnline || false,
          }

          friendsData.push(friendData)

          // Load friend activities in the background
          loadFriendActivities(friendDoc.id, friendData)
        }
      }

      // Update friends state based on page
      if (page === 1) {
        setFriends(friendsData)
      } else {
        setFriends((prev) => [...prev, ...friendsData])
      }

      // Cache all friends data
      if (page === 1) {
        const allCachedFriends = (await getCachedData("friends")) || []
        const updatedCache = [...friendsData, ...allCachedFriends.filter((f) => !pageIds.includes(f.id))]
        await setCachedData("friends", updatedCache)
      }

      // Update pagination state
      setFriendsPage(page)
      setHasMoreFriends(endIndex < allFriendIds.length)
    } catch (err) {
      console.error("Error loading friends page:", err)
    } finally {
      setLoadingMoreFriends(false)
    }
  }

  // OPTIMIZATION 7: Load friend activities with caching
  const loadFriendActivities = async (friendId, friendData) => {
    try {
      // Check cache first
      const cacheKey = `friendActivities_${friendId}`
      const cachedActivities = await getCachedData(cacheKey)

      if (cachedActivities) {
        updateFriendWithActivity(friendId, cachedActivities[0], cachedActivities.length)
      }

      // Load fresh data in the background
      const activitiesRef = collection(db, "activities")
      const activitiesQuery = query(
        activitiesRef,
        where("userId", "==", friendId),
        orderBy("createdAt", "desc"),
        limit(5),
      )

      const activitiesSnapshot = await getDocs(activitiesQuery)
      if (!activitiesSnapshot.empty) {
        const activities = activitiesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))

        // Update cache
        await setCachedData(cacheKey, activities)

        // Update friend with activity data
        updateFriendWithActivity(friendId, activities[0], activities.length)
      }
    } catch (err) {
      console.warn(`Error loading activities for friend ${friendId}:`, err)
    }
  }

  const updateFriendWithActivity = (friendId, activity, activityCount) => {
    if (!activity) return

    setFriends((prevFriends) => {
      return prevFriends.map((f) => {
        if (f.id === friendId) {
          return {
            ...f,
            lastActivity: activity,
            streak: 1, // Simplified streak calculation
            totalDistance: activity.distance || 0,
            totalActivities: activityCount || 1,
          }
        }
        return f
      })
    })
  }

  // OPTIMIZATION 8: Load friend requests more efficiently
  const loadFriendRequests = async (userId) => {
    try {
      // Check cache first
      const cachedRequests = await getCachedData(`friendRequests_${userId}`)
      if (cachedRequests) {
        setFriendRequests(cachedRequests)
      }

      // Set up friend requests listener - OPTIMIZED to use a single listener
      const requestsRef = collection(db, "friendRequests")
      const requestsQuery = query(requestsRef, where("to", "==", userId), where("status", "==", "pending"))
      const requestsListener = onSnapshot(
        requestsQuery,
        async (querySnapshot) => {
          try {
            const requestsData = []
            const requestPromises = []
            const userCache = {}

            for (const requestDoc of querySnapshot.docs) {
              const requestData = requestDoc.data()

              // Create a promise for each request to fetch the sender's data
              const promise = (async () => {
                try {
                  // Check if we already have this user's data in our local cache
                  if (!userCache[requestData.from]) {
                    const fromUserDoc = await getDoc(doc(db, "users", requestData.from))
                    if (fromUserDoc.exists()) {
                      userCache[requestData.from] = fromUserDoc.data()
                    }
                  }

                  if (userCache[requestData.from]) {
                    const fromUserData = userCache[requestData.from]
                    const mutualFriends = 0 // Simplified to avoid extra reads

                    requestsData.push({
                      id: requestDoc.id,
                      ...requestData,
                      fromUser: { id: requestData.from, ...fromUserData },
                      mutualFriends,
                    })
                  }
                } catch (err) {
                  console.warn(`Error processing friend request ${requestDoc.id}:`, err)
                }
              })()

              requestPromises.push(promise)
            }

            // Wait for all promises to resolve
            await Promise.all(requestPromises)
            setFriendRequests(requestsData)

            // Update cache
            await setCachedData(`friendRequests_${userId}`, requestsData)
          } catch (err) {
            console.error("Error processing friend requests:", err)
            setError("Failed to load friend requests.")
          }
        },
        (error) => {
          console.error("Error in friend requests listener:", error)
          setError("Failed to load friend requests.")
        },
      )

      unsubscribersRef.current.push(requestsListener)
    } catch (err) {
      console.error("Error setting up friend requests listener:", err)
    }
  }

  // OPTIMIZATION 9: Load challenges more efficiently
  const loadChallenges = async () => {
    try {
      // Check cache first
      const cachedChallenges = await getCachedData("challenges")
      if (cachedChallenges) {
        setChallenges(cachedChallenges)
      }

      // Set up challenges listener with reduced frequency
      const challengesRef = collection(db, "challenges")
      const challengesQuery = query(challengesRef, limit(5)) // Reduced limit

      // OPTIMIZATION: Use a one-time get instead of a listener
      const challengesSnapshot = await getDocs(challengesQuery)
      const now = new Date()
      const challengesData = challengesSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
          endDate: doc.data().endDate?.toDate() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }))
        .filter((challenge) => challenge.endDate >= now)

      setChallenges(challengesData)

      // Cache challenges
      await setCachedData("challenges", challengesData)

      // Set up a listener only for new challenges
      const lastChallengeTime =
        challengesData.length > 0 ? challengesData[0].createdAt : Timestamp.fromDate(new Date(0))

      const newChallengesQuery = query(challengesRef, where("createdAt", ">", lastChallengeTime), limit(5))

      const challengesListener = onSnapshot(
        newChallengesQuery,
        (querySnapshot) => {
          if (querySnapshot.empty) return

          try {
            const now = new Date()
            const newChallengesData = querySnapshot.docs
              .map((doc) => ({
                id: doc.id,
                ...doc.data(),
                endDate: doc.data().endDate?.toDate() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              }))
              .filter((challenge) => challenge.endDate >= now)

            if (newChallengesData.length > 0) {
              setChallenges((prev) => {
                const combined = [...newChallengesData, ...prev]
                // Deduplicate
                const uniqueChallenges = combined.filter(
                  (challenge, index, self) => index === self.findIndex((c) => c.id === challenge.id),
                )
                // Update cache
                setCachedData("challenges", uniqueChallenges)
                return uniqueChallenges
              })
            }
          } catch (err) {
            console.error("Error processing challenges:", err)
          }
        },
        (error) => {
          console.error("Error in challenges listener:", error)
        },
      )

      unsubscribersRef.current.push(challengesListener)
    } catch (err) {
      console.error("Error loading challenges:", err)
    }
  }

  // OPTIMIZATION 10: Load leaderboard with caching
  const loadLeaderboardData = async () => {
    try {
      // Check cache first
      const cachedLeaderboard = await getCachedData("leaderboard")
      if (cachedLeaderboard) {
        setLeaderboard(cachedLeaderboard)
      }

      const user = auth.currentUser
      if (!user) return

      // OPTIMIZATION: Use aggregation queries if available, or batch processing
      const activitiesRef = collection(db, "activities")
      const activitiesQuery = query(activitiesRef, limit(50)) // Increased limit but with less frequent updates
      const activitiesSnapshot = await getDocs(activitiesQuery)

      // Group activities by user
      const userDistances = {}
      const userNames = {}
      const userAvatars = {}
      const userDocs = {}

      for (const activityDoc of activitiesSnapshot.docs) {
        const activityData = activityDoc.data()
        const userId = activityData.userId

        if (!userId) continue

        // Add distance to user's total
        if (!userDistances[userId]) {
          userDistances[userId] = 0
        }

        userDistances[userId] += activityData.distance || 0
      }

      // Batch get user data for all users in the leaderboard
      const userIds = Object.keys(userDistances)
      if (userIds.length > 0) {
        // Split into chunks of 10 for batched gets (Firestore limit)
        const chunks = []
        for (let i = 0; i < userIds.length; i += 10) {
          chunks.push(userIds.slice(i, i + 10))
        }

        for (const chunk of chunks) {
          const usersQuery = query(collection(db, "users"), where(documentId(), "in", chunk))

          const usersSnapshot = await getDocs(usersQuery)

          for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data()
            userNames[userDoc.id] = userData.displayName || userData.username || "User"
            userAvatars[userDoc.id] = userData.avatar || DEFAULT_AVATAR
            userDocs[userDoc.id] = userData
          }
        }
      }

      // Convert to array and sort
      const leaderboardData = userIds.map((userId) => ({
        id: userId,
        name: userNames[userId] || "User",
        avatar: userAvatars[userId] || DEFAULT_AVATAR,
        distance: userDistances[userId],
        isCurrentUser: userId === user.uid,
        isOnline: userDocs[userId]?.isOnline || false,
      }))

      // Sort by distance (highest first)
      leaderboardData.sort((a, b) => b.distance - a.distance)
      const topLeaderboard = leaderboardData.slice(0, 10) // Top 10

      setLeaderboard(topLeaderboard)

      // Cache leaderboard
      await setCachedData("leaderboard", topLeaderboard)
    } catch (err) {
      console.warn("Error creating leaderboard:", err)
      setError(`Error loading leaderboard: ${err.message}`)
    }
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true)

    // Refresh data based on active tab
    if (activeTab === "leaderboard") {
      loadLeaderboardData().finally(() => setRefreshing(false))
    } else if (activeTab === "challenges") {
      loadChallenges().finally(() => setRefreshing(false))
    } else if (activeTab === "friends" && userProfile?.friends) {
      loadInitialFriends(userProfile.friends).finally(() => setRefreshing(false))
    } else {
      setRefreshing(false)
    }
  }, [activeTab, userProfile?.friends])

  // OPTIMIZATION 11: Load more friends when scrolling
  const loadMoreFriends = () => {
    if (loadingMoreFriends || !hasMoreFriends || !userProfile?.friends) return

    loadFriendsPage(userProfile.friends, friendsPage + 1)
  }

  // OPTIMIZATION 12: Debounced search
  useEffect(() => {
    if (debouncedSearchQuery) {
      searchUsers(debouncedSearchQuery)
    } else {
      setSearchResults([])
    }
  }, [debouncedSearchQuery])

  // Search for users - OPTIMIZED
  const searchUsers = async (searchTerm) => {
    if (!searchTerm.trim()) {
      setSearchResults([])
      return
    }

    try {
      setSearchLoading(true)
      const user = auth.currentUser

      // Get current user's friends
      const userDoc = await getDoc(doc(db, "users", user.uid))
      const userFriends = userDoc.data()?.friends || []

      // OPTIMIZATION: Use a more efficient query approach
      // This is a simplified approach - ideally you'd use a proper search index
      const usersRef = collection(db, "users")

      // OPTIMIZATION: Cache search results
      const cacheKey = `search_${searchTerm.toLowerCase()}`
      const cachedResults = await getCachedData(cacheKey)

      if (cachedResults) {
        // Update friend status on cached results
        const updatedResults = cachedResults.map((result) => ({
          ...result,
          isFriend: userFriends.includes(result.id),
        }))
        setSearchResults(updatedResults)
        setSearchLoading(false)

        // Still perform search in background to get fresh results
        performSearch(searchTerm, userFriends, cacheKey)
        return
      }

      await performSearch(searchTerm, userFriends, cacheKey)
    } catch (err) {
      console.error("Error searching users:", err)
      setSearchLoading(false)
      setError(`Error searching users: ${err.message}`)
      showModal({
        title: "Search Error",
        message: "There was a problem searching for users. Please try again.",
        type: "error",
      })
    }
  }

  const performSearch = async (searchTerm, userFriends, cacheKey) => {
    try {
      const user = auth.currentUser
      const usersRef = collection(db, "users")
      const usersSnapshot = await getDocs(query(usersRef, limit(20)))

      const results = []
      const lowerQuery = searchTerm.toLowerCase()

      for (const userDoc of usersSnapshot.docs) {
        // Skip current user
        if (userDoc.id === user.uid) continue

        const userData = userDoc.data()
        const displayName = userData.displayName || ""
        const username = userData.username || ""

        // Check if name or username contains search query
        if (displayName.toLowerCase().includes(lowerQuery) || username.toLowerCase().includes(lowerQuery)) {
          // Check if already friends
          const isFriend = userFriends.includes(userDoc.id)

          // OPTIMIZATION: Simplified request check
          let requestSent = false

          // Only check for pending requests if not already friends
          if (!isFriend) {
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
          }

          // Check if user is online
          const isOnline = userData.isOnline || false

          results.push({
            id: userDoc.id,
            ...userData,
            isFriend,
            requestSent,
            isOnline,
          })
        }
      }

      // Cache results
      await setCachedData(cacheKey, results)

      setSearchResults(results)
      setSearchLoading(false)
    } catch (err) {
      console.error("Error in background search:", err)
    }
  }

  // Send friend request - OPTIMIZED
  const sendFriendRequest = async (userId) => {
    try {
      // Set loading state for this specific user
      setSendingFriendRequests((prev) => ({ ...prev, [userId]: true }))

      const user = auth.currentUser

      // Check if request already exists to avoid duplicates
      const requestsRef = collection(db, "friendRequests")
      const existingRequestQuery = query(
        requestsRef,
        where("from", "==", user.uid),
        where("to", "==", userId),
        where("status", "==", "pending"),
      )

      const existingRequestSnapshot = await getDocs(existingRequestQuery)

      if (!existingRequestSnapshot.empty) {
        showModal({
          title: "Request Already Sent",
          message: "You've already sent a friend request to this user.",
          type: "info",
        })
        return
      }

      // Add friend request to database
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

      showModal({ title: "Success", message: "Friend request sent successfully!", type: "success" })
    } catch (err) {
      console.error("Error sending friend request:", err)
      showModal({ title: "Error", message: "Failed to send friend request. Please try again.", type: "error" })
    } finally {
      // Clear loading state
      setSendingFriendRequests((prev) => ({ ...prev, [userId]: false }))
    }
  }
  // Add this function to your CommunityScreen component
  // Replace your current acceptFriendRequest function with this one
  const acceptFriendRequest = async (requestId, fromUserId) => {
    try {
      // Set loading state for this specific request
      setProcessingRequests((prev) => ({ ...prev, [requestId]: "accepting" }))

      // Show loading modal
      showModal({
        title: "Accepting...",
        message: "Accepting friend request...",
        type: "info",
        confirmText: "",
        showCancelButton: false,
        onConfirm: null,
        onCancel: null,
      })

      const user = auth.currentUser

      // IMPORTANT: First verify that all documents exist
      // Check if the request document exists
      const requestRef = doc(db, "friendRequests", requestId)
      const requestDoc = await getDoc(requestRef)

      if (!requestDoc.exists()) {
        throw new Error("Friend request not found. It may have been deleted or already processed.")
      }

      // Check if both user documents exist
      const currentUserRef = doc(db, "users", user.uid)
      const fromUserRef = doc(db, "users", fromUserId)

      const [currentUserDoc, fromUserDoc] = await Promise.all([getDoc(currentUserRef), getDoc(fromUserRef)])

      if (!currentUserDoc.exists()) {
        throw new Error("Your user profile could not be found. Please try refreshing the app.")
      }

      if (!fromUserDoc.exists()) {
        throw new Error("The other user's profile could not be found. They may have deleted their account.")
      }

      // IMPORTANT: Instead of using a batch, perform individual updates
      // This is necessary because of the security rules

      // 1. Update request status
      await updateDoc(requestRef, {
        status: "accepted",
        updatedAt: serverTimestamp(),
      })

      // 2. Update current user's friends list
      const currentUserFriends = currentUserDoc.data().friends || []
      if (!currentUserFriends.includes(fromUserId)) {
        await updateDoc(currentUserRef, {
          friends: [...currentUserFriends, fromUserId],
        })
      }

      // 3. Update other user's friends list
      // This is the tricky part - we need to update the other user's document
      // with our security rules
      try {
        const fromUserFriends = fromUserDoc.data().friends || []
        if (!fromUserFriends.includes(user.uid)) {
          await updateDoc(fromUserRef, {
            friends: [...fromUserFriends, user.uid],
          })
        }
      } catch (updateError) {
        console.error("Error updating friend's document:", updateError)
        // We'll continue even if this fails, as the friend request was accepted
        // The other user can refresh to see the updated friend list
      }

      // Create a chat room for the two users
      try {
        const chatRoomId = [user.uid, fromUserId].sort().join("_")
        const chatRoomRef = doc(db, "chatRooms", chatRoomId)
        const chatRoomDoc = await getDoc(chatRoomRef)

        if (!chatRoomDoc.exists()) {
          await setDoc(chatRoomRef, {
            participants: [user.uid, fromUserId],
            createdAt: serverTimestamp(),
            lastMessage: null,
            lastMessageTime: null,
          })
        }
      } catch (err) {
        console.warn("Could not create chat room:", err)
        // Don't throw here, as the friend request was already accepted
      }

      // Remove the request from the UI
      setFriendRequests((prev) => prev.filter((req) => req.id !== requestId))

      // Update friends list in the UI
      if (userProfile?.friends) {
        const updatedFriends = [...userProfile.friends, fromUserId]
        setUserProfile((prev) => ({
          ...prev,
          friends: updatedFriends,
        }))

        // Load the new friend
        const friendData = {
          id: fromUserId,
          ...fromUserDoc.data(),
          lastActivity: null,
          streak: 0,
          totalDistance: 0,
          totalActivities: 0,
          isOnline: fromUserDoc.data().isOnline || false,
        }

        setFriends((prev) => [friendData, ...prev])

        // Load friend activities in the background
        loadFriendActivities(fromUserId, friendData)
      }

      // Show success modal
      showModal({ title: "Success", message: "Friend request accepted!", type: "success" })
    } catch (err) {
      console.error("Error accepting friend request:", err)

      // Provide more specific error messages based on the error
      let errorMessage = "Failed to accept friend request. Please try again."

      if (err.code === "permission-denied") {
        errorMessage = "You don't have permission to accept this friend request. Please check your account permissions."
      } else if (err.code === "not-found") {
        errorMessage = "The friend request or user profile could not be found. It may have been deleted."
      } else if (err.message) {
        errorMessage = err.message
      }

      showModal({ title: "Error", message: errorMessage, type: "error" })
    } finally {
      // Clear loading state
      setProcessingRequests((prev) => ({ ...prev, [requestId]: null }))
    }
  }

  // Reject friend request - OPTIMIZED
  const rejectFriendRequest = async (requestId) => {
    try {
      // Set loading state for this specific request
      setProcessingRequests((prev) => ({ ...prev, [requestId]: "rejecting" }))

      // Update request status
      const requestRef = doc(db, "friendRequests", requestId)
      await updateDoc(requestRef, {
        status: "rejected",
        updatedAt: serverTimestamp(),
      })

      // Remove the request from the UI
      setFriendRequests((prev) => prev.filter((req) => req.id !== requestId))

      showModal({ title: "Success", message: "Friend request rejected.", type: "success" })
    } catch (err) {
      console.error("Error rejecting friend request:", err)
      showModal({ title: "Error", message: "Failed to reject friend request. Please try again.", type: "error" })
    } finally {
      // Clear loading state
      setProcessingRequests((prev) => ({ ...prev, [requestId]: null }))
    }
  }

  // Create a new challenge - OPTIMIZED
  const createChallenge = async () => {
    try {
      if (!newChallenge.title.trim()) {
        showModal({ title: "Error", message: "Please enter a challenge title", type: "error" })
        return
      }

      setCreatingChallenge(true)
      const user = auth.currentUser

      const challengeData = {
        title: newChallenge.title,
        description: newChallenge.description,
        type: newChallenge.type,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        endDate: Timestamp.fromDate(newChallenge.endDate),
        isPublic: true,
        participants: [user.uid],
      }

      const challengeRef = await addDoc(collection(db, "challenges"), challengeData)

      // Reset form and close modal
      setNewChallenge({
        title: "",
        description: "",
        type: "Walking",
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      setIsCreateChallengeModalVisible(false)

      // Add the new challenge to the state to avoid refetching
      const newChallengeWithId = {
        id: challengeRef.id,
        ...challengeData,
        endDate: newChallenge.endDate,
      }

      setChallenges((prev) => [newChallengeWithId, ...prev])

      // Update cache
      const cachedChallenges = (await getCachedData("challenges")) || []
      await setCachedData("challenges", [newChallengeWithId, ...cachedChallenges])

      showModal({ title: "Success", message: "Challenge created successfully!", type: "success" })
    } catch (err) {
      console.error("Error creating challenge:", err)
      showModal({ title: "Error", message: "Failed to create challenge. Please try again.", type: "error" })
    } finally {
      setCreatingChallenge(false)
    }
  }

  // Join challenge - OPTIMIZED
  const joinChallenge = async (challengeId) => {
    try {
      // Set loading state for this specific challenge
      setJoiningChallenges((prev) => ({ ...prev, [challengeId]: true }))

      const user = auth.currentUser

      // Get the challenge
      const challengeRef = doc(db, "challenges", challengeId)
      const challengeDoc = await getDoc(challengeRef)

      if (!challengeDoc.exists()) {
        showModal({ title: "Error", message: "Challenge not found", type: "error" })
        return
      }

      const challengeData = challengeDoc.data()

      // Check if user is already a participant
      const participants = challengeData.participants || []
      if (participants.includes(user.uid)) {
        showModal({ title: "Already Joined", message: "You are already participating in this challenge", type: "info" })
        return
      }

      // Add user to participants
      await updateDoc(challengeRef, {
        participants: arrayUnion(user.uid),
      })

      // Update the challenge in state
      setChallenges((prev) =>
        prev.map((challenge) =>
          challenge.id === challengeId ? { ...challenge, participants: [...participants, user.uid] } : challenge,
        ),
      )

      // Update cache
      const cachedChallenges = (await getCachedData("challenges")) || []
      const updatedCachedChallenges = cachedChallenges.map((challenge) =>
        challenge.id === challengeId
          ? { ...challenge, participants: [...(challenge.participants || []), user.uid] }
          : challenge,
      )
      await setCachedData("challenges", updatedCachedChallenges)

      showModal({ title: "Success", message: "You've joined the challenge!", type: "success" })
    } catch (err) {
      console.error("Error joining challenge:", err)
      showModal({ title: "Error", message: "Failed to join challenge. Please try again.", type: "error" })
    } finally {
      // Clear loading state
      setJoiningChallenges((prev) => ({ ...prev, [challengeId]: false }))
    }
  }

  // View friend profile
  const viewFriendProfile = (friend) => {
    setSelectedFriend(friend)
    setIsFriendProfileVisible(true)
  }

  // Open chat with friend - OPTIMIZED
  const openChat = async (friend) => {
    try {
      setOpeningChat(true)
      setChatLoading(true)
      const user = auth.currentUser

      if (!user) {
        throw new Error("User not authenticated")
      }

      // Create or get chat room ID (sorted user IDs joined with underscore)
      const chatRoomId = [user.uid, friend.id].sort().join("_")

      // Check cache first
      const cachedMessages = await getCachedData(`chatMessages_${chatRoomId}`)
      if (cachedMessages) {
        setChatMessages(cachedMessages)
        setChatLoading(false)
      }

      // IMPORTANT FIX: Check if the chat room exists first
      const chatRoomRef = doc(db, `chatRooms/${chatRoomId}`)
      const chatRoomDoc = await getDoc(chatRoomRef)

      // If chat room doesn't exist, create it with proper participants
      if (!chatRoomDoc.exists()) {
        try {
          // Create the chat room document first
          await setDoc(chatRoomRef, {
            participants: [user.uid, friend.id],
            createdAt: serverTimestamp(),
            lastMessage: null,
            lastMessageTime: null,
          })

          // Wait a moment for the document to be fully created
          await new Promise((resolve) => setTimeout(resolve, 500))

          console.log("Chat room created successfully")
        } catch (createErr) {
          console.error("Error creating chat room:", createErr)
          throw new Error("Failed to create chat room: " + createErr.message)
        }
      }

      // Now fetch messages - with better error handling
      try {
        // Fetch only the last 20 messages instead of all messages
        const messagesRef = collection(db, `chatRooms/${chatRoomId}/messages`)
        const messagesQuery = query(messagesRef, orderBy("timestamp", "desc"), limit(20))

        // Fetch messages once instead of using a listener
        const messagesSnapshot = await getDocs(messagesQuery)
        const messages = messagesSnapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate() || new Date(),
          }))
          .reverse() // Reverse to get chronological order

        // Clear any existing messages to prevent duplicates
        setChatMessages(messages)
        setChatLoading(false)

        // Cache messages
        await setCachedData(`chatMessages_${chatRoomId}`, messages)

        // Now set up a listener for new messages only
        const lastMessageTime = messages.length > 0 ? messages[messages.length - 1].timestamp : new Date(0)

        const newMessagesQuery = query(
          messagesRef,
          where("timestamp", ">", Timestamp.fromDate(lastMessageTime)),
          orderBy("timestamp", "asc"),
        )

        const unsubscribe = onSnapshot(
          newMessagesQuery,
          (querySnapshot) => {
            if (querySnapshot.empty) return

            const newMessages = querySnapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
              timestamp: doc.data().timestamp?.toDate() || new Date(),
            }))

            // Use a Set to track message IDs we've already seen
            setChatMessages((prev) => {
              const existingIds = new Set(prev.map((msg) => msg.id))
              const uniqueNewMessages = newMessages.filter((msg) => !existingIds.has(msg.id))

              if (uniqueNewMessages.length === 0) return prev

              const updated = [...prev, ...uniqueNewMessages]
              // Update cache
              setCachedData(`chatMessages_${chatRoomId}`, updated)
              return updated
            })

            // Scroll to bottom when new messages arrive
            setTimeout(() => {
              if (chatScrollRef.current) {
                chatScrollRef.current.scrollToEnd({ animated: true })
              }
            }, 100)
          },
          (error) => {
            console.error("Error in chat messages listener:", error)
          },
        )

        // Add unsubscribe function to ref for cleanup
        unsubscribersRef.current.push(unsubscribe)
      } catch (messagesErr) {
        console.error("Error fetching chat messages:", messagesErr)
        setChatLoading(false)
        throw new Error("Failed to load messages: " + messagesErr.message)
      }

      // Set selected friend and open chat modal
      setSelectedFriend(friend)
      setIsChatModalVisible(true)

      // Scroll to bottom after a short delay
      setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollToEnd({ animated: false })
        }
      }, 300)
    } catch (err) {
      console.error("Error opening chat:", err)
      setChatLoading(false)

      // More specific error message based on error type
      let errorMessage = "Failed to open chat. Please try again."
      if (err.code === "permission-denied") {
        errorMessage = "You don't have permission to access this chat. This may be due to security rules."
      }

      showModal({
        title: "Chat Error",
        message: errorMessage,
        type: "error",
      })
    } finally {
      setOpeningChat(false)
    }
  }

  // Send chat message - OPTIMIZED
  const sendMessage = async () => {
    if (!chatMessage.trim() || !selectedFriend || sendingMessage) return

    try {
      setSendingMessage(true)
      const user = auth.currentUser
      const chatRoomId = [user.uid, selectedFriend.id].sort().join("_")
      const messageText = chatMessage.trim()

      // Clear input immediately for better UX
      setChatMessage("")

      // Create a unique temporary ID
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

      // Add message to local state immediately for better UX
      const tempMessage = {
        text: messageText,
        senderId: user.uid,
        senderName: userProfile?.username || user.displayName || "You",
        id: tempId,
        timestamp: new Date(),
        status: "sending",
      }

      setChatMessages((prev) => [...prev, tempMessage])

      // Scroll to bottom
      setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollToEnd({ animated: true })
        }
      }, 100)

      // OPTIMIZATION: Use a batch write for sending message
      const batch = writeBatch(db)

      // Add message to chat room
      const messagesRef = collection(db, `chatRooms/${chatRoomId}/messages`)
      const newMessageRef = doc(messagesRef)
      const newMessage = {
        text: messageText,
        senderId: user.uid,
        senderName: userProfile?.username || user.displayName || "You",
        timestamp: serverTimestamp(),
      }

      batch.set(newMessageRef, newMessage)

      // Update chat room with last message
      const chatRoomRef = doc(db, "chatRooms", chatRoomId)
      batch.update(chatRoomRef, {
        lastMessage: messageText,
        lastMessageTime: serverTimestamp(),
      })

      // Commit the batch
      await batch.commit()

      // Update the temp message with the real ID
      setChatMessages((prev) =>
        prev.map((msg) => (msg.id === tempId ? { ...msg, id: newMessageRef.id, status: "sent" } : msg)),
      )
    } catch (err) {
      console.error("Error sending message:", err)
      showModal({ title: "Error", message: "Failed to send message. Please try again.", type: "error" })

      // Remove the temporary message if sending failed
      setChatMessages((prev) => prev.filter((msg) => msg.status !== "sending"))
    } finally {
      setSendingMessage(false)
    }
  }

  // Send challenge to friend
  const sendChallengeToFriend = async () => {
    try {
      setSendingChallenge(true)

      // Close the profile modal first for better UX
      setIsFriendProfileVisible(false)

      // In a real implementation, you would create a challenge and add the friend
      // For now, we'll just show a success message
      setTimeout(() => {
        showModal({
          title: "Challenge Sent",
          message: `Challenge sent to ${selectedFriend.displayName || selectedFriend.username || "User"}!`,
          type: "success",
        })
        setSendingChallenge(false)
      }, 1000)
    } catch (err) {
      console.error("Error sending challenge:", err)
      showModal({ title: "Error", message: "Failed to send challenge. Please try again.", type: "error" })
      setSendingChallenge(false)
    }
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
      <View style={twrnc`relative`}>
        <Image source={{ uri: item.avatar || DEFAULT_AVATAR }} style={twrnc`w-12 h-12 rounded-full bg-gray-700`} />
        <View
          style={twrnc`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[#2A2E3A] ${
            item.isOnline ? "bg-green-500" : "bg-gray-500"
          }`}
        />
      </View>
      <View style={twrnc`ml-3 flex-1`}>
        <View style={twrnc`flex-row items-center`}>
          <CustomText weight="semibold" style={twrnc`text-white text-base`}>
            {item.displayName || item.username || "User"}
          </CustomText>
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
      <View style={twrnc`relative`}>
        <Image
          source={{ uri: item.fromUser.avatar || DEFAULT_AVATAR }}
          style={twrnc`w-12 h-12 rounded-full bg-gray-700`}
        />
        <View
          style={twrnc`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[#2A2E3A] ${
            item.fromUser.isOnline ? "bg-green-500" : "bg-gray-500"
          }`}
        />
      </View>
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
          style={twrnc`${processingRequests[item.id] === "accepting" ? "bg-green-700" : "bg-[#4CAF50]"} p-2 rounded-full mr-2`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => acceptFriendRequest(item.id, item.fromUser.id)}
          disabled={processingRequests[item.id] !== undefined}
        >
          {processingRequests[item.id] === "accepting" ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Feather name="check" size={18} color="white" />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={twrnc`${processingRequests[item.id] === "rejecting" ? "bg-red-700" : "bg-[#F44336]"} p-2 rounded-full`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => rejectFriendRequest(item.id)}
          disabled={processingRequests[item.id] !== undefined}
        >
          {processingRequests[item.id] === "rejecting" ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Feather name="x" size={18} color="white" />
          )}
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
            {item.participants?.length || 0} participant{item.participants?.length !== 1 ? "s" : ""}
          </CustomText>
        </View>
        <View style={twrnc`flex-row items-center mt-1`}>
          <Ionicons name="time-outline" size={14} color="#FFC107" />
          <CustomText style={twrnc`text-[#FFC107] text-xs ml-1`}>
            {item.endDate ? `Ends ${new Date(item.endDate).toLocaleDateString()}` : "Ongoing"}
          </CustomText>
        </View>
      </View>
      <TouchableOpacity
        style={twrnc`${joiningChallenges[item.id] ? "bg-[#3251DD]" : "bg-[#4361EE]"} py-2 px-4 rounded-full`}
        onPress={() => joinChallenge(item.id)}
        disabled={
          joiningChallenges[item.id] ||
          (Array.isArray(item.participants) && item.participants.includes(auth.currentUser?.uid))
        }
      >
        {joiningChallenges[item.id] ? (
          <ActivityIndicator size="small" color="white" />
        ) : Array.isArray(item.participants) && item.participants.includes(auth.currentUser?.uid) ? (
          <CustomText weight="medium" style={twrnc`text-white text-sm`}>
            Joined
          </CustomText>
        ) : (
          <CustomText weight="medium" style={twrnc`text-white text-sm`}>
            Join
          </CustomText>
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  )

  // Render search result item
  const renderSearchResultItem = ({ item }) => (
    <View style={twrnc`flex-row items-center p-4 bg-[#2A2E3A] rounded-xl mb-3`}>
      <View style={twrnc`relative`}>
        <Image source={{ uri: item.avatar || DEFAULT_AVATAR }} style={twrnc`w-12 h-12 rounded-full bg-gray-700`} />
        <View
          style={twrnc`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[#2A2E3A] ${
            item.isOnline ? "bg-green-500" : "bg-gray-500"
          }`}
        />
      </View>
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
        <TouchableOpacity
          style={twrnc`${sendingFriendRequests[item.id] ? "bg-[#3251DD]" : "bg-[#4361EE]"} py-2 px-4 rounded-full`}
          onPress={() => sendFriendRequest(item.id)}
          disabled={sendingFriendRequests[item.id]}
        >
          {sendingFriendRequests[item.id] ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <CustomText weight="medium" style={twrnc`text-white text-sm`}>
              Add
            </CustomText>
          )}
        </TouchableOpacity>
      )}
    </View>
  )

  // Render chat message
  const renderChatMessage = ({ item }) => {
    const user = auth.currentUser
    const isOwnMessage = item.senderId === user.uid

    return (
      <View style={twrnc`flex-row ${isOwnMessage ? "justify-end" : "justify-start"} mb-3`}>
        {!isOwnMessage && (
          <Image
            source={{ uri: selectedFriend?.avatar || DEFAULT_AVATAR }}
            style={twrnc`w-8 h-8 rounded-full mr-2 mt-1`}
          />
        )}
        <View
          style={twrnc`max-w-[80%] rounded-2xl p-3 ${
            isOwnMessage ? "bg-[#4361EE] rounded-tr-none" : "bg-[#2A2E3A] rounded-tl-none"
          }`}
        >
          <CustomText style={twrnc`text-white`}>{item.text}</CustomText>
          <CustomText style={twrnc`text-gray-300 text-xs mt-1 text-right`}>
            {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </CustomText>
        </View>
      </View>
    )
  }

  // OPTIMIZATION: Add a footer component to load more friends
  const renderFriendsFooter = () => {
    if (!hasMoreFriends) return null

    return (
      <TouchableOpacity
        style={twrnc`items-center justify-center py-4 ${loadingMoreFriends ? "opacity-50" : ""}`}
        onPress={loadMoreFriends}
        disabled={loadingMoreFriends}
      >
        {loadingMoreFriends ? (
          <ActivityIndicator size="small" color="#4361EE" />
        ) : (
          <CustomText style={twrnc`text-[#4361EE]`}>Load More Friends</CustomText>
        )}
      </TouchableOpacity>
    )
  }

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
        <TouchableOpacity style={twrnc`bg-[#4361EE] px-6 py-3 rounded-lg`} onPress={onRefresh}>
          <CustomText style={twrnc`text-white font-bold`}>Try Again</CustomText>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      {/* CustomModal integration */}
      <CustomModal visible={modalVisible} onClose={() => setModalVisible(false)} {...modalProps} />

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
            enabled={initialLoadComplete} // Only enable pull-to-refresh after initial load
          />
        }
      >
        {activeTab === "friends" && (
          <>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="semibold" style={twrnc`text-white`}>
                Your Friends ({userProfile?.friends?.length || 0})
              </CustomText>
              <TouchableOpacity onPress={() => setIsAddFriendModalVisible(true)}>
                <CustomText style={twrnc`text-[#4361EE]`}>Add New</CustomText>
              </TouchableOpacity>
            </View>

            {friends.length > 0 ? (
              <>
                <FlatList
                  data={friends}
                  renderItem={renderFriendItem}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  ListFooterComponent={renderFriendsFooter}
                />
              </>
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
              <TouchableOpacity onPress={() => setIsCreateChallengeModalVisible(true)}>
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
                <TouchableOpacity
                  style={twrnc`bg-[#4361EE] py-2 px-6 rounded-full`}
                  onPress={() => setIsCreateChallengeModalVisible(true)}
                >
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
                      style={twrnc`w-8 h-8 rounded-full ${
                        index === 0
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
                    <View style={twrnc`relative ml-3`}>
                      <Image
                        source={{ uri: user.avatar || DEFAULT_AVATAR }}
                        style={twrnc`w-10 h-10 rounded-full bg-gray-700`}
                      />
                      <View
                        style={twrnc`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#2A2E3A] ${
                          user.isOnline ? "bg-green-500" : "bg-gray-500"
                        }`}
                      />
                    </View>
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
                      {userProfile?.friends?.length || 0}
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

                <TouchableOpacity
                  style={twrnc`bg-[#4361EE] bg-opacity-20 rounded-lg p-3 items-center`}
                  onPress={() => {
                    if (navigation && navigation.navigate) {
                      navigation.navigate("Profile")
                    } else {
                      showModal({ title: "Navigation", message: "Profile navigation not available", type: "info" })
                    }
                  }}
                >
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
                onChangeText={setSearchQuery}
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

      {/* Create Challenge Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isCreateChallengeModalVisible}
        onRequestClose={() => setIsCreateChallengeModalVisible(false)}
      >
        <View style={twrnc`flex-1 bg-black bg-opacity-50 justify-end`}>
          <View style={twrnc`bg-[#121826] rounded-t-2xl p-5 h-2/3`}>
            <View style={twrnc`flex-row justify-between items-center mb-4`}>
              <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                Create Challenge
              </CustomText>
              <TouchableOpacity
                style={twrnc`bg-[#2A2E3A] p-2 rounded-full`}
                onPress={() => setIsCreateChallengeModalVisible(false)}
              >
                <FontAwesome name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={twrnc`mb-4`}>
              <CustomText style={twrnc`text-white mb-2`}>Challenge Title</CustomText>
              <TextInput
                style={twrnc`bg-[#2A2E3A] text-white p-3 rounded-lg`}
                placeholder="Enter challenge title"
                placeholderTextColor="#6B7280"
                value={newChallenge.title}
                onChangeText={(text) => setNewChallenge({ ...newChallenge, title: text })}
              />
            </View>

            <View style={twrnc`mb-4`}>
              <CustomText style={twrnc`text-white mb-2`}>Description</CustomText>
              <TextInput
                style={twrnc`bg-[#2A2E3A] text-white p-3 rounded-lg h-20`}
                placeholder="Enter challenge description"
                placeholderTextColor="#6B7280"
                multiline={true}
                value={newChallenge.description}
                onChangeText={(text) => setNewChallenge({ ...newChallenge, description: text })}
              />
            </View>

            <View style={twrnc`mb-4`}>
              <CustomText style={twrnc`text-white mb-2`}>Challenge Type</CustomText>
              <View style={twrnc`flex-row justify-between`}>
                {["Walking", "Running", "Cycling"].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={twrnc`bg-[#2A2E3A] p-3 rounded-lg flex-1 mx-1 ${
                      newChallenge.type === type ? "border-2 border-[#4361EE]" : ""
                    }`}
                    onPress={() => setNewChallenge({ ...newChallenge, type })}
                  >
                    <CustomText style={twrnc`text-white text-center ${newChallenge.type === type ? "font-bold" : ""}`}>
                      {type}
                    </CustomText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={twrnc`mb-6`}>
              <CustomText style={twrnc`text-white mb-2`}>Duration</CustomText>
              <View style={twrnc`flex-row justify-between`}>
                {[7, 14, 30].map((days) => (
                  <TouchableOpacity
                    key={days}
                    style={twrnc`bg-[#2A2E3A] p-3 rounded-lg flex-1 mx-1 ${
                      Math.round((newChallenge.endDate - new Date()) / (24 * 60 * 60 * 1000)) === days
                        ? "border-2 border-[#4361EE]"
                        : ""
                    }`}
                    onPress={() =>
                      setNewChallenge({
                        ...newChallenge,
                        endDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
                      })
                    }
                  >
                    <CustomText
                      style={twrnc`text-white text-center ${
                        Math.round((newChallenge.endDate - new Date()) / (24 * 60 * 60 * 1000)) === days
                          ? "font-bold"
                          : ""
                      }`}
                    >
                      {days} Days
                    </CustomText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={twrnc`bg-[#4361EE] p-4 rounded-lg flex-row justify-center items-center`}
              onPress={createChallenge}
              disabled={creatingChallenge}
            >
              {creatingChallenge ? (
                <>
                  <ActivityIndicator size="small" color="white" style={twrnc`mr-2`} />
                  <CustomText style={twrnc`text-white text-center font-bold`}>Creating...</CustomText>
                </>
              ) : (
                <CustomText style={twrnc`text-white text-center font-bold`}>Create Challenge</CustomText>
              )}
            </TouchableOpacity>
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
                <View style={twrnc`relative`}>
                  <Image
                    source={{ uri: selectedFriend.avatar || DEFAULT_AVATAR }}
                    style={twrnc`w-24 h-24 rounded-full bg-gray-700 mb-3`}
                  />
                  <View
                    style={twrnc`absolute bottom-3 right-0 w-5 h-5 rounded-full border-2 border-[#121826] ${
                      selectedFriend.isOnline ? "bg-green-500" : "bg-gray-500"
                    }`}
                  />
                </View>
                <CustomText weight="bold" style={twrnc`text-white text-xl`}>
                  {selectedFriend.displayName || selectedFriend.username || "User"}
                </CustomText>
                <View style={twrnc`flex-row items-center mt-1`}>
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
                    {selectedFriend.lastActivity.activityType === "running" ? (
                      <FontAwesome name="running" size={18} color="#FFC107" style={twrnc`mr-2`} />
                    ) : selectedFriend.lastActivity.activityType === "cycling" ? (
                      <FontAwesome name="bicycle" size={18} color="#FFC107" style={twrnc`mr-2`} />
                    ) : (
                      <MaterialCommunityIcons name="walk" size={18} color="#FFC107" style={twrnc`mr-2`} />
                    )}
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
                  style={twrnc`${sendingChallenge ? "bg-[#3251DD]" : "bg-[#4361EE]"} rounded-xl py-3 px-4 flex-1 mr-2 items-center flex-row justify-center`}
                  onPress={sendChallengeToFriend}
                  disabled={sendingChallenge}
                >
                  {sendingChallenge ? (
                    <>
                      <ActivityIndicator size="small" color="white" style={twrnc`mr-2`} />
                      <CustomText weight="semibold" style={twrnc`text-white`}>
                        Sending...
                      </CustomText>
                    </>
                  ) : (
                    <CustomText weight="semibold" style={twrnc`text-white`}>
                      Challenge Friend
                    </CustomText>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`${openingChat ? "bg-[#1F2330]" : "bg-[#2A2E3A]"} rounded-xl py-3 px-4 flex-1 ml-2 items-center flex-row justify-center`}
                  onPress={() => {
                    setIsFriendProfileVisible(false)
                    openChat(selectedFriend)
                  }}
                  disabled={openingChat}
                >
                  {openingChat ? (
                    <>
                      <ActivityIndicator size="small" color="white" style={twrnc`mr-2`} />
                      <CustomText weight="semibold" style={twrnc`text-white`}>
                        Opening...
                      </CustomText>
                    </>
                  ) : (
                    <CustomText weight="semibold" style={twrnc`text-white`}>
                      Message
                    </CustomText>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>

      {/* Chat Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isChatModalVisible}
        onRequestClose={() => setIsChatModalVisible(false)}
      >
        {selectedFriend && (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={twrnc`flex-1`}>
            <View style={twrnc`flex-1 bg-black bg-opacity-50`}>
              <View style={twrnc`bg-[#121826] flex-1`}>
                {/* Chat Header */}
                <View style={twrnc`flex-row items-center p-4 bg-[#1A1F2E] border-b border-[#2A3447]`}>
                  <TouchableOpacity style={twrnc`mr-3`} onPress={() => setIsChatModalVisible(false)}>
                    <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
                  </TouchableOpacity>

                  <View style={twrnc`relative`}>
                    <Image
                      source={{ uri: selectedFriend.avatar || DEFAULT_AVATAR }}
                      style={twrnc`w-10 h-10 rounded-full`}
                    />
                    <View
                      style={twrnc`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#1A1F2E] ${
                        selectedFriend.isOnline ? "bg-green-500" : "bg-gray-500"
                      }`}
                    />
                  </View>

                  <View style={twrnc`ml-3 flex-1`}>
                    <CustomText weight="semibold" style={twrnc`text-white`}>
                      {selectedFriend.displayName || selectedFriend.username || "User"}
                    </CustomText>
                    <CustomText style={twrnc`text-gray-400 text-xs`}>
                      {selectedFriend.isOnline ? "Online" : "Offline"}
                    </CustomText>
                  </View>
                </View>

                {/* Chat Messages */}
                {chatLoading ? (
                  <View style={twrnc`flex-1 justify-center items-center`}>
                    <ActivityIndicator size="large" color="#4361EE" />
                    <CustomText style={twrnc`text-white mt-3`}>Loading messages...</CustomText>
                  </View>
                ) : (
                  <FlatList
                    ref={chatScrollRef}
                    data={chatMessages}
                    renderItem={renderChatMessage}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={twrnc`p-4`}
                    onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: false })}
                    ListEmptyComponent={
                      <View style={twrnc`flex-1 justify-center items-center py-10`}>
                        <Ionicons name="chatbubble-ellipses-outline" size={48} color="#4361EE" />
                        <CustomText style={twrnc`text-white text-center mt-4 mb-2`}>No messages yet</CustomText>
                        <CustomText style={twrnc`text-gray-400 text-center px-6`}>
                          Send a message to start chatting with{" "}
                          {selectedFriend.displayName || selectedFriend.username || "your friend"}
                        </CustomText>
                      </View>
                    }
                  />
                )}

                {/* Message Input */}
                <View style={twrnc`p-2 border-t border-[#2A3447] bg-[#1A1F2E] flex-row items-center`}>
                  <TextInput
                    style={twrnc`flex-1 bg-[#2A2E3A] text-white rounded-full px-4 py-2 mr-2`}
                    placeholder="Type a message..."
                    placeholderTextColor="#6B7280"
                    value={chatMessage}
                    onChangeText={setChatMessage}
                    multiline
                    editable={!sendingMessage}
                  />
                  <TouchableOpacity
                    style={twrnc`${sendingMessage ? "bg-[#3251DD]" : "bg-[#4361EE]"} w-10 h-10 rounded-full items-center justify-center ${!chatMessage.trim() ? "opacity-50" : ""}`}
                    onPress={sendMessage}
                    disabled={!chatMessage.trim() || sendingMessage}
                  >
                    {sendingMessage ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Ionicons name="send" size={20} color="white" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </Modal>

      {/* Offline Mode Indicator */}
      {offlineMode && (
        <View
          style={twrnc`absolute bottom-4 left-4 right-4 bg-[#FFC107] p-3 rounded-lg flex-row items-center justify-between`}
        >
          <View style={twrnc`flex-row items-center`}>
            <Ionicons name="cloud-offline" size={20} color="#121826" />
            <CustomText style={twrnc`text-[#121826] font-medium ml-2`}>Offline Mode</CustomText>
          </View>
          <CustomText style={twrnc`text-[#121826] text-xs`}>
            Last synced: {lastOnlineSync ? formatLastActive(lastOnlineSync) : "Never"}
          </CustomText>
        </View>
      )}
    </View>
  )
}

export default CommunityScreen
