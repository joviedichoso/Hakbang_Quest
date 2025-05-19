"use client"

import { useRef, useState, useEffect } from "react"
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Share,
  Alert,
  Image,
} from "react-native"
import { Video } from "expo-av"
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from "react-native-maps"
import { captureRef } from "react-native-view-shot"
import * as FileSystem from "expo-file-system"
import * as Sharing from "expo-sharing"
import * as MediaLibrary from "expo-media-library"
import { FontAwesome, Ionicons } from "@expo/vector-icons"
import CustomText from "./CustomText"
import { LinearGradient } from "expo-linear-gradient"
import axios from "axios"
import { addDoc, collection, serverTimestamp } from "firebase/firestore"
import { db, auth } from "../firebaseConfig"

// Import FFmpeg conditionally to handle potential errors
let FFmpegKit = null
let ReturnCode = null
try {
  const FFmpegModule = require("ffmpeg-kit-react-native")
  FFmpegKit = FFmpegModule.FFmpegKit
  ReturnCode = FFmpegModule.ReturnCode
} catch (error) {
  console.log("FFmpeg module not available:", error)
}

const { width } = Dimensions.get("window")
const CAPTURE_RATE = 15 // Increased frames per second for smoother video
const ANIMATION_DURATION = 5000 // 5 seconds for the entire animation

// Import your app logo - replace this with the actual path to your logo
const APP_LOGO = require("../assets/image/icon.png")

const RouteAnimationVideo = ({
  coordinates,
  activityType,
  distance,
  duration,
  date,
  userName = "User", // Default to "User" instead of "Fitness User"
  onClose,
  onShare,
}) => {
  const mapRef = useRef(null)
  const viewShotRef = useRef(null)
  const [frames, setFrames] = useState([])
  const [videoUri, setVideoUri] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentPosition, setCurrentPosition] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const videoRef = useRef(null)
  const [hasMediaPermission, setHasMediaPermission] = useState(false)
  const [isVideoReady, setIsVideoReady] = useState(false)
  const [ffmpegAvailable, setFfmpegAvailable] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [animationStyle, setAnimationStyle] = useState("strava") // Default to Strava-style animation

  // Cloudinary configuration
  const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/dy5urwfw7/video/upload"
  const CLOUDINARY_UPLOAD_PRESET = "activity_videos"
  const CLOUDINARY_API_KEY = "785713797422187"
  const DEBUG_MODE = process.env.NODE_ENV === "development" // Automatically true in development, false in production

  // Check for media library permissions and FFmpeg availability on component mount
  useEffect(() => {
    ;(async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      setHasMediaPermission(status === "granted")

      if (status !== "granted") {
        console.log("Media library permission not granted")
      }

      // Check if FFmpeg is available
      try {
        if (FFmpegKit) {
          // Simple FFmpeg version check
          const session = await FFmpegKit.execute("-version")
          if (session) {
            const returnCode = await session.getReturnCode()
            const isSuccess = ReturnCode && ReturnCode.isSuccess && ReturnCode.isSuccess(returnCode)
            setFfmpegAvailable(isSuccess)
            console.log("FFmpeg is available:", isSuccess)
          } else {
            setFfmpegAvailable(false)
            console.log("FFmpeg session is null")
          }
        } else {
          setFfmpegAvailable(false)
          console.log("FFmpeg is not available")
        }
      } catch (error) {
        console.error("FFmpeg check failed:", error)
        setFfmpegAvailable(false)
      }
    })()
  }, [])

  // Calculate the region to display the entire route
  const calculateRegion = () => {
    if (!coordinates || coordinates.length === 0) {
      return {
        latitude: 0,
        longitude: 0,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    }

    const latitudes = coordinates.map((coord) => coord.latitude)
    const longitudes = coordinates.map((coord) => coord.longitude)

    const minLat = Math.min(...latitudes)
    const maxLat = Math.max(...latitudes)
    const minLng = Math.min(...longitudes)
    const maxLng = Math.max(...longitudes)

    const midLat = (minLat + maxLat) / 2
    const midLng = (minLng + maxLng) / 2

    // Add some padding
    const latDelta = (maxLat - minLat) * 1.5 || 0.01
    const lngDelta = (maxLng - minLng) * 1.5 || 0.01

    return {
      latitude: midLat,
      longitude: midLng,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    }
  }

  // Start the animation and recording process
  const startRecording = async () => {
    setIsGenerating(true)
    setIsRecording(true)
    setFrames([])
    setProgress(0)
    setCurrentPosition(0)

    // Create a temporary directory for frames if it doesn't exist
    const framesDir = `${FileSystem.cacheDirectory}frames/`
    try {
      const dirInfo = await FileSystem.getInfoAsync(framesDir)
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(framesDir, { intermediates: true })
      } else {
        // Clean up any existing frames
        const files = await FileSystem.readDirectoryAsync(framesDir)
        for (const file of files) {
          await FileSystem.deleteAsync(`${framesDir}${file}`)
        }
      }
    } catch (error) {
      console.error("Error preparing directory:", error)
      setIsGenerating(false)
      setIsRecording(false)
      Alert.alert("Error", "Failed to prepare for recording.")
      return
    }

    // Start the animation
    animateRoute()
  }

  // Animate the route by incrementally showing more of the path
  const animateRoute = () => {
    const totalFrames = CAPTURE_RATE * (ANIMATION_DURATION / 1000)
    const frameInterval = 1000 / CAPTURE_RATE
    let currentFrame = 0

    // For Strava-style animation, we'll use a different approach
    // Instead of just showing more of the path, we'll move a marker along the path
    // and have a "drawing" effect for the path behind it

    const captureFrame = async () => {
      if (currentFrame <= totalFrames) {
        const progress = currentFrame / totalFrames
        setProgress(progress)

        // Calculate the current position in the route
        // For Strava-style, we use a non-linear easing function to make it more dynamic
        const easedProgress = easeInOutCubic(progress)
        const newPosition = Math.floor(easedProgress * coordinates.length)
        setCurrentPosition(newPosition)

        // Wait a bit for the UI to update
        setTimeout(async () => {
          try {
            if (viewShotRef.current) {
              const uri = await captureRef(viewShotRef, {
                format: "jpg",
                quality: 0.9, // Higher quality for better video
              })

              // Save the frame
              const frameFileName = `${FileSystem.cacheDirectory}frames/frame_${currentFrame.toString().padStart(5, "0")}.jpg`
              await FileSystem.moveAsync({
                from: uri,
                to: frameFileName,
              })

              setFrames((prev) => [...prev, frameFileName])
            }
          } catch (error) {
            console.error("Error capturing frame:", error)
          }

          currentFrame++
          if (currentFrame <= totalFrames) {
            setTimeout(captureFrame, frameInterval)
          } else {
            // All frames captured, generate video
            if (ffmpegAvailable) {
              generateVideo()
            } else {
              // If FFmpeg is not available, use the best frame as an image
              const middleFrameIndex = Math.floor(frames.length / 2)
              const bestFrameUri = frames[middleFrameIndex] || frames[frames.length - 1]

              // Create a permanent copy of the image
              const timestamp = new Date().getTime()
              const permanentUri = `${FileSystem.documentDirectory}hakbangquest_activity_${timestamp}.jpg`
              await FileSystem.copyAsync({
                from: bestFrameUri,
                to: permanentUri,
              })

              setVideoUri(permanentUri)
              setShowPreview(true)
              setIsVideoReady(false)

              // Upload the image to Cloudinary
              uploadToCloudinary(permanentUri, "image")

              Alert.alert(
                "Image Created",
                "Video creation is not available in this environment. An image of your route has been created instead.",
                [{ text: "OK" }],
              )
            }
          }
        }, 50) // Small delay to ensure UI updates
      }
    }

    captureFrame()
  }

  // Easing function for smoother animation (Strava-style)
  const easeInOutCubic = (t) => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  // Generate a video from the captured frames using FFmpeg
  const generateVideo = async () => {
    setIsRecording(false)

    if (frames.length === 0) {
      setIsGenerating(false)
      Alert.alert("Error", "No frames captured for video creation.")
      return
    }

    try {
      // Create a timestamp for the output file
      const timestamp = new Date().getTime()

      // If FFmpeg is not available, fall back to using the first frame as a static image
      if (!ffmpegAvailable || !FFmpegKit) {
        const middleFrameIndex = Math.floor(frames.length / 2)
        const bestFrameUri = frames[middleFrameIndex] || frames[frames.length - 1]

        // Create a permanent copy of the image
        const permanentUri = `${FileSystem.documentDirectory}hakbangquest_activity_${timestamp}.jpg`
        await FileSystem.copyAsync({
          from: bestFrameUri,
          to: permanentUri,
        })

        setVideoUri(permanentUri)
        setShowPreview(true)
        setIsVideoReady(false)

        // Upload the image to Cloudinary
        uploadToCloudinary(permanentUri, "image")

        Alert.alert(
          "Image Created",
          "Video creation is not available in this environment. An image of your route has been created instead.",
          [{ text: "OK" }],
        )
        return
      }

      // FFmpeg is available, proceed with video creation
      const outputVideoPath = `${FileSystem.documentDirectory}hakbangquest_activity_${timestamp}.mp4`

      // Create a temporary file list for FFmpeg
      const fileListPath = `${FileSystem.cacheDirectory}filelist.txt`
      let fileListContent = ""

      // Add each frame to the file list with a duration
      frames.forEach((frame) => {
        fileListContent += `file '${frame}'\nduration 0.${Math.floor(1000 / CAPTURE_RATE)}\n`
      })
      // Add the last frame again to ensure it's shown (FFmpeg requirement)
      if (frames.length > 0) {
        fileListContent += `file '${frames[frames.length - 1]}'\n`
      }

      // Write the file list
      await FileSystem.writeAsStringAsync(fileListPath, fileListContent)

      // Execute FFmpeg command to create video with higher quality settings
      const command = `-f concat -safe 0 -i ${fileListPath} -c:v libx264 -pix_fmt yuv420p -preset medium -crf 23 -r ${CAPTURE_RATE} ${outputVideoPath}`

      // Show progress update
      setProgress(0.5)

      // Execute the FFmpeg command
      const session = await FFmpegKit.execute(command)
      const returnCode = await session.getReturnCode()

      if (ReturnCode.isSuccess(returnCode)) {
        // Video created successfully
        setVideoUri(outputVideoPath)
        setShowPreview(true)
        setIsVideoReady(true)

        // Upload the video to Cloudinary
        uploadToCloudinary(outputVideoPath, "video")
      } else {
        // Fallback to using the first frame as a static image if video creation fails
        const middleFrameIndex = Math.floor(frames.length / 2)
        const bestFrameUri = frames[middleFrameIndex] || frames[frames.length - 1]

        // Create a permanent copy of the image
        const permanentUri = `${FileSystem.documentDirectory}hakbangquest_activity_${timestamp}.jpg`
        await FileSystem.copyAsync({
          from: bestFrameUri,
          to: permanentUri,
        })

        setVideoUri(permanentUri)
        setShowPreview(true)
        setIsVideoReady(false)

        // Upload the image to Cloudinary
        uploadToCloudinary(permanentUri, "image")
      }
    } catch (error) {
      console.error("Error generating video:", error)
      Alert.alert("Error", "Failed to generate video: " + error.message)
      const middleFrameIndex = Math.floor(frames.length / 2)
      const bestFrameUri = frames[middleFrameIndex] || frames[frames.length - 1]

      // Create a permanent copy of the image
      const timestamp = new Date().getTime()
      const permanentUri = `${FileSystem.documentDirectory}hakbangquest_activity_${timestamp}.jpg`
      await FileSystem.copyAsync({
        from: bestFrameUri,
        to: permanentUri,
      })

      setVideoUri(permanentUri)
      setShowPreview(true)
      setIsVideoReady(false)

      // Upload the image to Cloudinary
      uploadToCloudinary(permanentUri, "image")
    } finally {
      setIsGenerating(false)
    }
  }

  // Upload the video or image to Cloudinary
  const uploadToCloudinary = async (fileUri, fileType) => {
    setIsUploading(true)

    if (DEBUG_MODE) {
      console.log(`[Cloudinary Debug] Starting upload of ${fileType}`)
      console.log(`[Cloudinary Debug] File URI: ${fileUri}`)
    }

    try {
      // Determine the correct Cloudinary URL based on file type
      const uploadUrl =
        fileType === "video"
          ? "https://api.cloudinary.com/v1_1/dy5urwfw7/video/upload"
          : "https://api.cloudinary.com/v1_1/dy5urwfw7/image/upload"

      // Determine the correct upload preset based on file type
      const uploadPreset = fileType === "video" ? "activity_videos" : "activity"

      if (DEBUG_MODE) {
        console.log(`[Cloudinary Debug] Upload URL: ${uploadUrl}`)
        console.log(`[Cloudinary Debug] Upload Preset: ${uploadPreset}`)
      }

      const formData = new FormData()
      formData.append("file", {
        uri: Platform.OS === "ios" ? fileUri.replace("file://", "") : fileUri,
        type: fileType === "video" ? "video/mp4" : "image/jpeg",
        name: fileType === "video" ? `activity_${Date.now()}.mp4` : `activity_${Date.now()}.jpg`,
      })
      formData.append("upload_preset", uploadPreset)
      formData.append("api_key", CLOUDINARY_API_KEY)

      // Add timestamp for debugging
      const timestamp = Date.now().toString()
      formData.append("timestamp", timestamp)

      if (DEBUG_MODE) {
        console.log(`[Cloudinary Debug] FormData prepared with timestamp: ${timestamp}`)
        console.log(`[Cloudinary Debug] Sending request to Cloudinary...`)
      }

      const response = await axios.post(uploadUrl, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          if (DEBUG_MODE) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            console.log(`[Cloudinary Debug] Upload progress: ${percentCompleted}%`)
          }
        },
      })

      if (DEBUG_MODE) {
        console.log(`[Cloudinary Debug] Response received from Cloudinary`)
        console.log(`[Cloudinary Debug] Response status: ${response.status}`)
      }

      if (!response.data.secure_url) {
        console.error("Cloudinary response:", JSON.stringify(response.data, null, 2))
        throw new Error("No secure_url in Cloudinary response")
      }

      const mediaUrl = response.data.secure_url

      if (DEBUG_MODE) {
        console.log(`[Cloudinary Debug] Upload successful!`)
        console.log(`[Cloudinary Debug] Media URL: ${mediaUrl}`)
        console.log(`[Cloudinary Debug] Public ID: ${response.data.public_id || "unknown"}`)
        console.log(`[Cloudinary Debug] Format: ${response.data.format || "unknown"}`)
        console.log(`[Cloudinary Debug] Resource type: ${response.data.resource_type || "unknown"}`)
      }

      // Save to Firestore
      const user = auth.currentUser
      if (user) {
        const activitiesRef = collection(db, "activities")
        await addDoc(activitiesRef, {
          userId: user.uid,
          [fileType === "video" ? "videoUrl" : "imageUrl"]: mediaUrl,
          activityType,
          distance,
          duration,
          coordinates,
          createdAt: serverTimestamp(),
          cloudinaryPublicId: response.data.public_id || null,
          uploadTimestamp: timestamp,
        })

        if (DEBUG_MODE) {
          console.log(`[Cloudinary Debug] Activity saved to Firestore`)
        }
      }

      // Update the video URI to use the Cloudinary URL
      setVideoUri(mediaUrl)

      // Show a more detailed success message in debug mode
      if (DEBUG_MODE) {
        Alert.alert(
          fileType === "video" ? "Video Uploaded (DEBUG)" : "Image Uploaded (DEBUG)",
          `Your activity ${fileType} has been uploaded to Cloudinary and saved to your account.\n\nURL: ${mediaUrl}\nPublic ID: ${response.data.public_id || "unknown"}\nFormat: ${response.data.format || "unknown"}`,
          [{ text: "OK" }],
        )
      } else {
        Alert.alert(
          fileType === "video" ? "Video Uploaded" : "Image Uploaded",
          `Your activity ${fileType} has been uploaded to the cloud and saved to your account.`,
          [{ text: "OK" }],
        )
      }

      return {
        success: true,
        url: mediaUrl,
        publicId: response.data.public_id || null,
      }
    } catch (error) {
      console.error("Error uploading to Cloudinary:", error)

      if (DEBUG_MODE) {
        console.log(`[Cloudinary Debug] Upload failed with error: ${error.message}`)

        // Show more detailed error in debug mode
        Alert.alert(
          "Upload Failed (DEBUG)",
          `Could not upload to Cloudinary.\n\nError: ${error.message}\n\nCheck console logs for more details.`,
          [{ text: "OK" }],
        )
      } else {
        Alert.alert("Upload Failed", `Could not upload to cloud, but the ${fileType} is available locally.`, [
          { text: "OK" },
        ])
      }

      return {
        success: false,
        error: error.message,
      }
    } finally {
      setIsUploading(false)

      if (DEBUG_MODE) {
        console.log(`[Cloudinary Debug] Upload process completed`)
      }
    }
  }

  // Share the generated video
  const shareVideo = async () => {
    if (!videoUri) {
      Alert.alert("Error", "No animation available to share.")
      return
    }

    try {
      // Check if the URI is a Cloudinary URL (starts with http)
      const isCloudinaryUrl = videoUri.startsWith("http")

      if (Platform.OS === "android") {
        const shareOptions = {
          title: "Share your activity",
          message: `Check out my ${activityType} activity! I covered ${distance} in ${duration}.`,
          url: isCloudinaryUrl ? videoUri : `file://${videoUri}`,
        }
        await Share.share(shareOptions)
      } else {
        // iOS
        if (isCloudinaryUrl) {
          // For cloud URLs, use the Share API
          const shareOptions = {
            title: "Share your activity",
            message: `Check out my ${activityType} activity! I covered ${distance} in ${duration}.`,
            url: videoUri,
          }
          await Share.share(shareOptions)
        } else if (await Sharing.isAvailableAsync()) {
          // For local files, use Expo's Sharing
          await Sharing.shareAsync(videoUri, {
            dialogTitle: "Share your activity",
            mimeType: isVideoReady ? "video/mp4" : "image/jpeg",
            UTI: isVideoReady ? "public.movie" : "public.jpeg",
          })
        } else {
          Alert.alert("Sharing not available", "Sharing is not available on this device")
        }
      }

      if (onShare) {
        onShare(videoUri)
      }
    } catch (error) {
      console.error("Error sharing:", error)
      Alert.alert("Error", "Failed to share animation.")
    }
  }

  // Save the animation to gallery
  const saveToGallery = async () => {
    if (!videoUri) {
      Alert.alert("Error", "No animation available to save.")
      return
    }

    try {
      if (!hasMediaPermission) {
        const { status } = await MediaLibrary.requestPermissionsAsync()
        if (status !== "granted") {
          Alert.alert(
            "Permission Required",
            "To save to your gallery, you need to grant permission to access your media library.",
            [{ text: "OK" }],
          )
          return
        }
        setHasMediaPermission(true)
      }

      // If it's a Cloudinary URL, we need to download it first
      let localUri = videoUri
      if (videoUri.startsWith("http")) {
        const fileExt = isVideoReady ? ".mp4" : ".jpg"
        const downloadUri = `${FileSystem.documentDirectory}downloaded_activity${fileExt}`

        const downloadResumable = FileSystem.createDownloadResumable(videoUri, downloadUri, {}, (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
          console.log(`Download progress: ${progress * 100}%`)
        })

        const { uri } = await downloadResumable.downloadAsync()
        localUri = uri
      }

      // Save to the media library
      const asset = await MediaLibrary.createAssetAsync(localUri)

      // Create an album if it doesn't exist
      const album = await MediaLibrary.getAlbumAsync("HakbangQuest")
      if (album === null) {
        await MediaLibrary.createAlbumAsync("HakbangQuest", asset, false)
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false)
      }

      Alert.alert(
        "Saved Successfully",
        `Your activity ${isVideoReady ? "video" : "image"} has been saved to your gallery in the HakbangQuest album.`,
        [{ text: "OK" }],
      )
    } catch (error) {
      console.error("Error saving to gallery:", error)
      Alert.alert("Save Failed", "There was an error saving to the gallery. Please try again.", [{ text: "OK" }])
    }
  }

  // Get the visible portion of the route based on current animation progress
  const getVisibleRoute = () => {
    if (!coordinates || coordinates.length === 0) return []
    return coordinates.slice(0, currentPosition + 1)
  }

  // Get the current position marker
  const getCurrentPositionMarker = () => {
    if (!coordinates || coordinates.length === 0 || currentPosition >= coordinates.length) return null
    return coordinates[currentPosition]
  }

  // Get activity color based on type
  const getActivityColor = () => {
    const colors = {
      walking: "#4361EE",
      running: "#EF476F",
      cycling: "#06D6A0",
      jogging: "#FFD166",
    }
    return colors[activityType] || "#4361EE"
  }

  // Format the date for display
  const formatDisplayDate = () => {
    if (!date) return ""
    const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" }
    return new Date(date).toLocaleDateString(undefined, options)
  }

  // Toggle animation style between Strava and default
  const toggleAnimationStyle = () => {
    setAnimationStyle(animationStyle === "strava" ? "default" : "strava")
  }

  return (
    <View style={styles.container}>
      {/* Close button */}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <FontAwesome name="close" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      {showPreview ? (
        // Animation preview screen
        <View style={styles.previewContainer}>
          <CustomText weight="bold" style={styles.title}>
            Your Activity {isVideoReady ? "Video" : "Image"}
          </CustomText>

          <View style={styles.videoContainer}>
            {isVideoReady ? (
              // Show video player if we have a video
              <Video
                ref={videoRef}
                source={{ uri: videoUri }}
                style={styles.video}
                useNativeControls
                resizeMode="contain"
                isLooping
                shouldPlay
              />
            ) : (
              // Fallback to image if video creation failed
              <Image source={{ uri: videoUri }} style={styles.video} resizeMode="contain" />
            )}
          </View>

          {isUploading && (
            <View style={styles.uploadingContainer}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <CustomText style={styles.uploadingText}>Uploading to cloud...</CustomText>
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: "#4361EE" }]} onPress={shareVideo}>
              <FontAwesome name="share-alt" size={20} color="#FFFFFF" style={styles.actionIcon} />
              <CustomText style={styles.actionText}>Share</CustomText>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionButton, { backgroundColor: "#06D6A0" }]} onPress={saveToGallery}>
              <FontAwesome name="download" size={20} color="#FFFFFF" style={styles.actionIcon} />
              <CustomText style={styles.actionText}>Save</CustomText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: "#FFD166" }]}
              onPress={() => {
                setShowPreview(false)
                setCurrentPosition(0)
              }}
            >
              <FontAwesome name="refresh" size={20} color="#121826" style={styles.actionIcon} />
              <CustomText style={[styles.actionText, { color: "#121826" }]}>New</CustomText>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // Animation creation screen
        <View style={styles.animationContainer}>
          <CustomText weight="bold" style={styles.title}>
            Create Activity {ffmpegAvailable ? "Video" : "Image"}
          </CustomText>

          {/* Map view with route animation */}
          <View ref={viewShotRef} style={styles.mapContainer} collapsable={false}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={calculateRegion()}
              provider={PROVIDER_GOOGLE}
              customMapStyle={[
                { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFC107" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
              ]}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
            >
              {/* Completed route portion */}
              <Polyline
                coordinates={getVisibleRoute()}
                strokeColor={getActivityColor()}
                strokeWidth={4}
                lineCap="round"
                lineJoin="round"
              />

              {/* Current position marker */}
              {getCurrentPositionMarker() && (
                <Marker coordinate={getCurrentPositionMarker()}>
                  <View style={[styles.positionMarker, { backgroundColor: getActivityColor() }]}>
                    {activityType === "cycling" ? (
                      <FontAwesome name="bicycle" size={12} color="#FFFFFF" />
                    ) : (
                      <Ionicons name="walk" size={12} color="#FFFFFF" />
                    )}
                  </View>
                </Marker>
              )}
            </MapView>

            {/* Activity info overlay */}
            <LinearGradient colors={["rgba(18, 24, 38, 0.8)", "transparent"]} style={styles.infoOverlay}>
              <View style={styles.infoContainer}>
                <CustomText weight="bold" style={styles.userName}>
                  {userName}
                </CustomText>
                <CustomText style={styles.activityInfo}>
                  {activityType.charAt(0).toUpperCase() + activityType.slice(1)} • {distance} • {duration}
                </CustomText>
                <CustomText style={styles.dateInfo}>{formatDisplayDate()}</CustomText>
              </View>
            </LinearGradient>

            {/* App branding with logo */}
            <View style={styles.brandingContainer}>
              <View style={styles.brandingContent}>
                <Image source={APP_LOGO} style={styles.brandingLogo} resizeMode="contain" />
                <CustomText weight="bold" style={styles.brandingText}>
                  HakbangQuest
                </CustomText>
              </View>
            </View>
          </View>

          {/* Progress bar */}
          {isGenerating && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBackground}>
                <View
                  style={[styles.progressBar, { width: `${progress * 100}%`, backgroundColor: getActivityColor() }]}
                />
              </View>
              <CustomText style={styles.progressText}>
                {isRecording
                  ? `Recording frames: ${Math.round(progress * 100)}%`
                  : `Creating ${ffmpegAvailable ? "video" : "image"}: ${Math.round(progress * 100)}%`}
              </CustomText>
            </View>
          )}

          {/* Animation style toggle */}
          <TouchableOpacity style={styles.styleToggle} onPress={toggleAnimationStyle}>
            <CustomText style={styles.styleToggleText}>
              Style: {animationStyle === "strava" ? "Strava" : "Default"}
            </CustomText>
            <FontAwesome name="exchange" size={16} color="#FFFFFF" style={{ marginLeft: 8 }} />
          </TouchableOpacity>

          {/* Action buttons */}
          <View style={styles.buttonContainer}>
            {isGenerating ? (
              <View style={styles.loadingButton}>
                <ActivityIndicator color="#FFFFFF" size="small" style={styles.loadingIndicator} />
                <CustomText style={styles.buttonText}>
                  {isRecording ? "Recording frames..." : `Generating ${ffmpegAvailable ? "video" : "image"}...`}
                </CustomText>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.startButton, { backgroundColor: getActivityColor() }]}
                onPress={startRecording}
              >
                <Ionicons
                  name={ffmpegAvailable ? "videocam" : "image"}
                  size={24}
                  color="#FFFFFF"
                  style={styles.buttonIcon}
                />
                <CustomText weight="bold" style={styles.buttonText}>
                  Create {ffmpegAvailable ? "Video" : "Image"}
                </CustomText>
              </TouchableOpacity>
            )}
          </View>

          <CustomText style={styles.helpText}>
            This will create a shareable {ffmpegAvailable ? "video" : "image"} of your activity route that you can post
            on social media.
          </CustomText>

          <View style={styles.infoBox}>
            <FontAwesome name="info-circle" size={16} color="#4361EE" style={styles.infoIcon} />
            <CustomText style={styles.infoText}>
              {ffmpegAvailable
                ? "Video creation is available. You can create and share your route animation."
                : "Video creation is not available in this environment. Images will be created instead. For full video capabilities, please use the EAS build version of the app."}
            </CustomText>
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121826",
    padding: 20,
  },
  closeButton: {
    position: "absolute",
    top: 20,
    right: 20,
    zIndex: 10,
    backgroundColor: "rgba(42, 46, 58, 0.8)",
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    marginBottom: 20,
    textAlign: "center",
  },
  animationContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mapContainer: {
    width: width - 40,
    height: width - 40,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 20,
  },
  map: {
    width: "100%",
    height: "100%",
  },
  positionMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    // Add shadow for better visibility
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  infoOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
  },
  infoContainer: {
    marginBottom: 10,
  },
  userName: {
    color: "#FFFFFF",
    fontSize: 16,
    marginBottom: 4,
  },
  activityInfo: {
    color: "#FFFFFF",
    fontSize: 14,
    marginBottom: 2,
  },
  dateInfo: {
    color: "#CCCCCC",
    fontSize: 12,
  },
  brandingContainer: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(18, 24, 38, 0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  brandingContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandingLogo: {
    width: 16,
    height: 16,
    marginRight: 4,
  },
  brandingText: {
    color: "#FFFFFF",
    fontSize: 12,
  },
  progressContainer: {
    width: "100%",
    marginBottom: 20,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: "#2A2E3A",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressBar: {
    height: "100%",
    borderRadius: 4,
  },
  progressText: {
    color: "#CCCCCC",
    fontSize: 12,
    textAlign: "center",
  },
  buttonContainer: {
    marginBottom: 20,
    width: "100%",
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    width: "100%",
  },
  loadingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    width: "100%",
    backgroundColor: "#2A2E3A",
  },
  buttonIcon: {
    marginRight: 10,
  },
  loadingIndicator: {
    marginRight: 10,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
  },
  helpText: {
    color: "#CCCCCC",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  infoBox: {
    flexDirection: "row",
    backgroundColor: "rgba(67, 97, 238, 0.1)",
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 20,
    alignItems: "flex-start",
  },
  infoIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  infoText: {
    color: "#CCCCCC",
    fontSize: 12,
    flex: 1,
  },
  previewContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  videoContainer: {
    width: width - 40,
    height: width - 40,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 20,
    backgroundColor: "#000000",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    marginTop: 10,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 12,
    flex: 1,
    marginHorizontal: 5,
  },
  actionIcon: {
    marginRight: 8,
  },
  actionText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "bold",
  },
  uploadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  uploadingText: {
    color: "#FFFFFF",
    marginLeft: 8,
    fontSize: 14,
  },
  styleToggle: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2A2E3A",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 16,
  },
  styleToggleText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
})

export default RouteAnimationVideo
