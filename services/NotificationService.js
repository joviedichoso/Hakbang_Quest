import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { Platform } from "react-native"
import { db, auth } from "../firebaseConfig"
import {
    doc,
    collection,
    addDoc,
    updateDoc,
    serverTimestamp,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
} from "firebase/firestore"
import { limit as firestoreLimit } from "firebase/firestore"

class NotificationService {
    // Initialize the notification service
    static async initialize() {
        // Configure notification handler
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: true,
            }),
        })

        // Register for push notifications if on a device
        if (Device.isDevice) {
            await this.registerForPushNotifications()
        }

        // Update badge count
        await this.updateBadgeCount()
    }

    // Register for push notifications
    static async registerForPushNotifications() {
        try {
            const { status: existingStatus } = await Notifications.getPermissionsAsync()
            let finalStatus = existingStatus

            if (existingStatus !== "granted") {
                const { status } = await Notifications.requestPermissionsAsync()
                finalStatus = status
            }

            if (finalStatus !== "granted") {
                return false
            }

            // Get push token
            const tokenData = await Notifications.getExpoPushTokenAsync({
                projectId: "a74f26e2-cc0c-4544-b860-af2692a8c3f8",
            })

            // Save token to user profile in Firestore
            const user = auth.currentUser
            if (user) {
                const userRef = doc(db, "users", user.uid)
                await updateDoc(userRef, {
                    pushToken: tokenData.data,
                    deviceType: Platform.OS,
                })
            }

            return true
        } catch (error) {
            console.warn("Error getting push token:", error)
            return false
        }
    }

    // Update badge count based on unread notifications
    static async updateBadgeCount() {
        try {
            if (Platform.OS !== "ios") return

            const user = auth.currentUser
            if (!user) return

            const notificationsRef = collection(db, "notifications")
            const unreadQuery = query(notificationsRef, where("userId", "==", user.uid), where("read", "==", false))

            const unreadSnapshot = await getDocs(unreadQuery)
            const unreadCount = unreadSnapshot.size

            await Notifications.setBadgeCountAsync(unreadCount)

            return unreadCount
        } catch (error) {
            console.warn("Error updating badge count:", error)
            return 0
        }
    }

    // Create a new notification
    static async createNotification(userId, data) {
        try {
            const notificationData = {
                userId,
                ...data,
                read: false,
                createdAt: serverTimestamp(),
            }

            const notificationsRef = collection(db, "notifications")
            const notificationDoc = await addDoc(notificationsRef, notificationData)

            // Send push notification if user has a push token
            await this.sendPushNotification(userId, data)

            return notificationDoc.id
        } catch (error) {
            console.error("Error creating notification:", error)
            return null
        }
    }

    // Send push notification
    static async sendPushNotification(userId, data) {
        try {
            // Get user's push token
            const userRef = doc(db, "users", userId)
            const userDoc = await getDoc(userRef)

            if (!userDoc.exists()) return

            const userData = userDoc.data()
            const pushToken = userData.pushToken

            if (!pushToken) return

            // Prepare notification message
            const message = {
                to: pushToken,
                sound: "default",
                title: data.title || "New Notification",
                body: data.message || "You have a new notification",
                data: {
                    ...data,
                    notificationId: data.id,
                },
                badge: 1,
            }

            // Send notification via Expo's push notification service
            await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Accept-encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(message),
            })
        } catch (error) {
            console.error("Error sending push notification:", error)
        }
    }

    // Get notifications for a user
    static async getNotifications(userId, limitCount = 10) {
        try {
            const notificationsRef = collection(db, "notifications")
            // Fix: Use firestoreLimit as a function, not as a property
            const notificationsQuery = query(
                notificationsRef,
                where("userId", "==", userId),
                orderBy("createdAt", "desc"),
                firestoreLimit(limitCount) // <-- this must be called as a function
            )

            const notificationsSnapshot = await getDocs(notificationsQuery)

            return notificationsSnapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date(),
            }))
        } catch (error) {
            console.error("Error getting notifications:", error)
            return []
        }
    }

    // Mark notification as read
    static async markAsRead(notificationId) {
        try {
            const notificationRef = doc(db, "notifications", notificationId)
            await updateDoc(notificationRef, {
                read: true,
                readAt: serverTimestamp(),
            })
            return true
        } catch (error) {
            console.error("Error marking notification as read:", error)
            return false
        }
    }

    // Mark all notifications as read
    static async markAllAsRead(userId) {
        try {
            const notificationsRef = collection(db, "notifications")
            const unreadQuery = query(notificationsRef, where("userId", "==", userId), where("read", "==", false))

            const unreadSnapshot = await getDocs(unreadQuery)

            // Check if there are any unread notifications
            if (unreadSnapshot.empty) {
                return true
            }

            // Use a batch to update all notifications
            const batch = db.batch()
            unreadSnapshot.docs.forEach((doc) => {
                batch.update(doc.ref, {
                    read: true,
                    readAt: serverTimestamp(),
                })
            })

            await batch.commit()
            return true
        } catch (error) {
            console.error("Error marking all as read:", error)
            return false
        }
    }
}

export default NotificationService
