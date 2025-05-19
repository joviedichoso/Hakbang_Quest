"use client"

import { useRef, useEffect } from "react"
import { Animated, Easing } from "react-native"

// This component handles the Strava-style animation for the map
const StravaStyleAnimator = ({ mapRef, coordinates, currentPosition, isRecording, duration = 5000 }) => {
  // Animation values
  const zoomAnim = useRef(new Animated.Value(0)).current
  const pitchAnim = useRef(new Animated.Value(0)).current
  const headingAnim = useRef(new Animated.Value(0)).current

  // Track if animation is in progress
  const animationInProgress = useRef(false)

  // Calculate the center point of the route
  const getCenterCoordinate = () => {
    if (!coordinates || coordinates.length === 0) return null

    // Use the current position or the middle of the route
    if (currentPosition > 0 && currentPosition < coordinates.length) {
      return coordinates[currentPosition]
    }

    const midIndex = Math.floor(coordinates.length / 2)
    return coordinates[midIndex]
  }

  // Start the camera animation when recording begins
  useEffect(() => {
    if (isRecording && coordinates && coordinates.length > 0 && !animationInProgress.current) {
      animationInProgress.current = true

      // Reset animation values
      zoomAnim.setValue(0)
      pitchAnim.setValue(0)
      headingAnim.setValue(0)

      // Create animation sequence
      const animateCamera = () => {
        // First zoom out slightly
        Animated.timing(zoomAnim, {
          toValue: 1,
          duration: duration * 0.3,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }).start()

        // Then tilt the camera
        setTimeout(() => {
          Animated.timing(pitchAnim, {
            toValue: 1,
            duration: duration * 0.4,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.cubic),
          }).start()
        }, duration * 0.2)

        // Finally rotate slightly
        setTimeout(() => {
          Animated.timing(headingAnim, {
            toValue: 1,
            duration: duration * 0.6,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.cubic),
          }).start(() => {
            animationInProgress.current = false
          })
        }, duration * 0.3)
      }

      // Start the animation
      animateCamera()

      // Update the map camera
      if (mapRef.current) {
        const centerCoord = getCenterCoordinate()
        if (centerCoord) {
          mapRef.current.animateCamera(
            {
              center: centerCoord,
              pitch: 45,
              heading: 30,
              altitude: 0,
              zoom: 15,
            },
            { duration: duration * 0.5 },
          )
        }
      }
    }
  }, [isRecording, coordinates, currentPosition])

  return null
}

export default StravaStyleAnimator
