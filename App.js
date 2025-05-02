import React, { useState, useEffect, useCallback } from 'react';
import { SafeAreaView, StatusBar, View, TouchableOpacity, Image, Alert, Dimensions, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import * as Location from 'expo-location';
import twrnc from 'twrnc';
import { FontAwesome } from '@expo/vector-icons';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig'; 

import LandingScreen from './screens/LandingScreen';
import LoginScreen from './screens/LoginScreen';
import SignupScreen from './screens/SignupScreen';
import DashboardScreen from './screens/DashboardScreen';
import ActivityScreen from './screens/ActivityScreen';
import ProfileScreen from './screens/ProfileScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import MapScreen from './screens/MapScreen';
import CustomText from './components/CustomText';
import CustomModal from './components/CustomModal'; 

import RunningIcon from './components/icons/running.png';
import FootprintsIcon from './components/icons/footprints.png';

SplashScreen.preventAutoHideAsync();

const { width } = Dimensions.get('window');
const isSmallDevice = width < 375;

const formatDate = () => {
  const date = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
};

const requestLocationPermissions = async () => {
  try {
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') return true;

    if (!canAskAgain) {
      Alert.alert('Permission Required', 'Location permissions are required. Please enable them in app settings.', [
        { text: 'Cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() }
      ]);
      return false;
    }

    Alert.alert('Permission Required', 'This app needs location permissions to work properly.', [{ text: 'OK' }]);
    return false;
  } catch (error) {
    console.error('Error requesting location permissions:', error);
    Alert.alert('Error', 'Failed to request location permissions');
    return false;
  }
};

const checkLocationPermissions = async () => {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    return granted;
  } catch (error) {
    console.error('Error checking location permissions:', error);
    return false;
  }
};

export default function App() {
  const [activeScreen, setActiveScreen] = useState('landing');
  const [userName, setUserName] = useState('');
  const [activityParams, setActivityParams] = useState({});
  const [locationGranted, setLocationGranted] = useState(false);
  const [fontsLoaded] = useFonts({
    'Poppins-Regular': require('./assets/fonts/Poppins-Regular.ttf'),
    'Poppins-Medium': require('./assets/fonts/Poppins-Medium.ttf'),
    'Poppins-SemiBold': require('./assets/fonts/Poppins-SemiBold.ttf'),
    'Poppins-Bold': require('./assets/fonts/Poppins-Bold.ttf'),
  });
  
  const [isNavigationLocked, setIsNavigationLocked] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [verificationModalShown, setVerificationModalShown] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');

  


  const handleAuthStateChange = useCallback(async (user) => {
    if (modalVisible) {
      return;
    }

    if (user) {
      await AsyncStorage.setItem('userId', user.uid);
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setUserName(userData.username || 'User');
        } else {
          setUserName('User');
        }

        if (user.emailVerified) {
          // Only navigate to dashboard if coming from landing, signin, or signup
          if (['landing', 'signin', 'signup'].includes(activeScreen)) {
            setActiveScreen('dashboard');
          }
          setIsNavigationLocked(false);
          setVerificationModalShown(false);
        } else {
          if (!verificationModalShown) {
            setModalVisible(true);
            setModalTitle('Email Verification Required');
            setModalMessage('Please verify your email before logging in.');
            setVerificationModalShown(true);
          }
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        await auth.signOut();
      }
    } else {
      await AsyncStorage.removeItem('userId');
      setUserName('');
      if (['signin', 'signup'].includes(activeScreen)) {
        setIsNavigationLocked(true);
      } else {
        setActiveScreen('landing');
        setIsNavigationLocked(false);
      }
    }
  }, [activeScreen, modalVisible, verificationModalShown]);

  useEffect(() => {
    const initApp = async () => {
      try {
        const isFirstLaunch = await AsyncStorage.getItem('isFirstLaunch');
        if (isFirstLaunch === null) {
          await AsyncStorage.setItem('isFirstLaunch', 'true');
          setActiveScreen('landing');
          return;
        }
        const hasPermissions = await checkLocationPermissions();
        setLocationGranted(hasPermissions);
        if (!hasPermissions) {
          const granted = await requestLocationPermissions();
          setLocationGranted(granted);
        }
        const unsubscribe = onAuthStateChanged(auth, handleAuthStateChange);
        return unsubscribe;
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        await SplashScreen.hideAsync();
      }
    };
    initApp();
  }, [handleAuthStateChange]);

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync();
  }, [fontsLoaded]);

  const navigateToMap = (params = {}) => {
    if (!locationGranted) {
      Alert.alert(
        'Location Required',
        'Please enable location services to use this feature',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    setActivityParams(params);
    setActiveScreen('map');
    setIsNavigationLocked(false);
  };

  const navigateToActivity = (params = {}) => {
    setActivityParams(params);
    setActiveScreen('activity');
    setIsNavigationLocked(false);
  };

  const navigateToDashboard = () => {
    setActivityParams({});
    setActiveScreen('dashboard');
    setIsNavigationLocked(false);
  };

  const navigateToSignIn = (email = '') => {
    setLoginEmail(email);
    setActiveScreen('signin');
    setIsNavigationLocked(true);
  };

  const navigateToSignUp = () => {
    setActiveScreen('signup');
    setIsNavigationLocked(true);
  };

  const navigateToLanding = () => {
    setActiveScreen('landing');
    setIsNavigationLocked(false);
  };

  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    if (hour < 20) return 'Good Evening';
    return 'Good Night';
  };

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={twrnc`flex-1 bg-[#121826]`} onLayout={onLayoutRootView}>
      <StatusBar barStyle="light-content" />

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
          setModalVisible(false);
          setIsNavigationLocked(false);
          navigateToSignIn(); // Navigate to SignIn after closing modal
        }}
      />

      {activeScreen === 'dashboard' && (
        <>
          <View style={twrnc`p-5`}>
            <CustomText style={twrnc`text-gray-400 text-sm`}>{formatDate()}</CustomText>
            <View style={twrnc`flex-row justify-between items-center mt-2`}>
              <View style={twrnc`flex-1 flex-row items-center`}>
                <CustomText
                  weight="bold"
                  style={twrnc`text-white ${isSmallDevice ? 'text-xl' : 'text-2xl'} flex-shrink-1`}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {getTimeBasedGreeting()}, {userName}!
                </CustomText>
              </View>
              <View style={twrnc`flex-row`}>
                <TouchableOpacity style={twrnc`bg-[#2A2E3A] rounded-full w-10 h-10 items-center justify-center mr-2`}>
                  <FontAwesome name="bell" size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={twrnc`bg-[#2A2E3A] rounded-full w-10 h-10 items-center justify-center`}
                  onPress={() => setActiveScreen('profile')}
                >
                  <FontAwesome name="user" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <DashboardScreen navigateToActivity={navigateToActivity} />
        </>
      )}

      {activeScreen === 'landing' && (
        <LandingScreen
          navigateToSignIn={navigateToSignIn}
          navigateToSignUp={navigateToSignUp}
        />
      )}

      {activeScreen === 'signin' && (
        <LoginScreen
          navigateToLanding={navigateToLanding}
          navigateToSignUp={navigateToSignUp}
          navigateToDashboard={navigateToDashboard}
          prefilledEmail={loginEmail}
        />
      )}

      {activeScreen === 'signup' && (
        <SignupScreen
          navigateToLanding={navigateToLanding}
          navigateToSignIn={navigateToSignIn}
          setIsNavigationLocked={setIsNavigationLocked}
        />
      )}

      {activeScreen === 'activity' && (
        <ActivityScreen
          navigateToDashboard={navigateToDashboard}
          navigateToMap={navigateToMap}
          params={activityParams}
        />
      )}

      {activeScreen === 'profile' && (
        <ProfileScreen
          navigateToDashboard={navigateToDashboard}
          navigateToLanding={navigateToLanding}
        />
      )}

      {activeScreen === 'Leaderboard' && (
        auth.currentUser ? (
          <LeaderboardScreen navigateToDashboard={navigateToDashboard} />
        ) : (
          <View style={twrnc`flex-1 bg-[#121826] justify-center items-center px-5`}>
            <FontAwesome name="lock" size={48} color="#FFC107" style={twrnc`mb-4`} />
            <CustomText style={twrnc`text-white text-center mb-4`}>
              Please sign in to view the leaderboard.
            </CustomText>
            <TouchableOpacity
              style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`}
              onPress={navigateToSignIn}
            >
              <CustomText style={twrnc`text-white`}>Sign In</CustomText>
            </TouchableOpacity>
          </View>
        )
      )}

      {activeScreen === 'map' && (
        <MapScreen
          navigateToActivity={navigateToActivity}
          navigateToDashboard={navigateToDashboard}
          params={activityParams}
        />
      )}

      {(activeScreen === 'dashboard' || activeScreen === 'profile' || activeScreen === 'Leaderboard') && (
        <View style={twrnc`flex-row justify-between items-center bg-[#1E2538] px-5 py-5 absolute bottom-0 w-full`}>
          <TouchableOpacity onPress={navigateToDashboard} style={twrnc`items-center`}>
            <FontAwesome
              name="home"
              size={30}
              color={activeScreen === 'dashboard' ? '#FFC107' : '#FFFFFF'}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigateToActivity()} style={twrnc`items-center`}>
            <Image
              source={RunningIcon}
              style={{
                width: 30,
                height: 30,
                resizeMode: 'contain',
                tintColor: activeScreen === 'activity' ? '#FFC107' : '#FFFFFF',
              }}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigateToMap({})} style={twrnc`-mt-18`}>
            <View style={twrnc`bg-[#FFC107] w-20 h-20 rounded-full items-center justify-center shadow-lg shadow-black/50`}>
              <Image
                source={FootprintsIcon}
                style={{
                  width: 50,
                  height: 50,
                  resizeMode: 'contain',
                  tintColor: '#FFFFFF',
                }}
              />
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setActiveScreen('Leaderboard')} style={twrnc`items-center`}>
            <FontAwesome
              name="trophy"
              size={30}
              color={activeScreen === 'Leaderboard' ? '#FFC107' : '#FFFFFF'}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setActiveScreen('profile')} style={twrnc`items-center`}>
            <FontAwesome
              name="user"
              size={30}
              color={activeScreen === 'profile' ? '#FFC107' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}