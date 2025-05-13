import React, { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  Image,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import { FontAwesome } from '@expo/vector-icons';
import { auth, db } from '../firebaseConfig';
import { signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, setDoc } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import CustomModal from '../components/CustomModal';

const ProfileScreen = ({ navigateToDashboard, navigateToLanding }) => {
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [userData, setUserData] = useState({
    username: 'User',
    email: 'user@example.com',
    avatar: 'https://randomuser.me/api/portraits/men/1.jpg',
    stats: {
      totalDistance: '0 km',
      totalActivities: '0',
      longestRun: '0 km',
    },
    badges: [],
  });
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dljywnlvh/image/upload';
  const CLOUDINARY_UPLOAD_PRESET = 'profile';

  const settingsItems = [
    {
      id: '1',
      title: 'Edit Profile',
      icon: 'pencil',
      iconBg: '#4361EE',
      action: () => console.log('Edit Profile'),
    },
    {
      id: '2',
      title: 'Notifications',
      icon: 'bell',
      iconBg: '#FFC107',
      action: () => console.log('Notifications'),
    },
    {
      id: '3',
      title: 'Help & Support',
      icon: 'question-circle',
      iconBg: '#4CC9F0',
      action: () => console.log('Help'),
    },
    {
      id: '4',
      title: 'Privacy Settings',
      icon: 'lock',
      iconBg: '#9C27B0',
      action: () => console.log('Privacy'),
    },
  ];

  const selectImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Denied', 'Please grant access to your photo library to select an image.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) {
        console.log('User cancelled image picker');
        return;
      }

      const uri = result.assets[0].uri;
      const mimeType = result.assets[0].mimeType || 'image/jpeg';
      await uploadImage(uri, mimeType);
    } catch (err) {
      console.error('Image picker error:', err.message, err.stack);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const uploadImage = async (uri, mimeType) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
        type: mimeType,
        name: `profile.${mimeType.split('/')[1] || 'jpg'}`,
      });
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

      const response = await axios.post(CLOUDINARY_URL, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (!response.data.secure_url) {
        console.error('Cloudinary response:', JSON.stringify(response.data, null, 2));
        throw new Error('No secure_url in Cloudinary response');
      }

      const imageUrl = response.data.secure_url;
      await saveImageUrlToFirestore(imageUrl);
      setUserData((prev) => ({ ...prev, avatar: imageUrl }));
    } catch (err) {
      console.error('Cloudinary upload error:', err.message, err.response?.data);
      Alert.alert('Error', `Failed to upload image: ${err.response?.data?.error?.message || 'Please check your network and try again.'}`);
    } finally {
      setUploading(false);
    }
  };

  const saveImageUrlToFirestore = async (imageUrl) => {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Not authenticated');
      }
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        await updateDoc(userRef, { avatar: imageUrl });
      } else {
        await setDoc(userRef, { avatar: imageUrl, username: userData.username || 'User', email: user.email });
      }
      console.log('Image URL saved to Firestore');
    } catch (err) {
      console.error('Firestore update error:', err);
      throw err;
    }
  };

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          throw new Error('Not authenticated');
        }

        const userDoc = await getDoc(doc(db, 'users', user.uid));
        let username = 'User';
        let avatar = userData.avatar;
        if (userDoc.exists()) {
          username = userDoc.data().username || 'User';
          avatar = userDoc.data().avatar || userData.avatar;
        }

        const activitiesQuery = query(collection(db, 'activities'), where('userId', '==', user.uid));
        const activitiesSnapshot = await getDocs(activitiesQuery);

        let totalDistance = 0;
        let totalActivities = 0;
        let longestRun = 0;

        activitiesSnapshot.forEach((doc) => {
          const activity = doc.data();
          totalDistance += activity.distance || 0;
          totalActivities += 1;
          longestRun = Math.max(longestRun, activity.distance || 0);
        });

        const badgesQuery = query(collection(db, 'userBadges'), where('userId', '==', user.uid));
        const badgesSnapshot = await getDocs(badgesQuery);
        const userBadges = badgesSnapshot.docs.map((doc) => doc.data().badgeId);

        const badgeDetails = [];
        for (const badgeId of userBadges) {
          const badgeDoc = await getDoc(doc(db, 'badges', badgeId));
          if (badgeDoc.exists()) {
            badgeDetails.push({
              id: badgeDoc.id,
              ...badgeDoc.data(),
            });
          }
        }

        const achievementsQuery = query(collection(db, 'userAchievements'), where('userId', '==', user.uid));
        const achievementsSnapshot = await getDocs(achievementsQuery);
        const userAchievements = achievementsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setUserData({
          username,
          email: user.email || userData.email,
          avatar,
          stats: {
            totalDistance: `${totalDistance.toFixed(1)} km`,
            totalActivities: `${totalActivities}`,
            longestRun: `${longestRun.toFixed(1)} km`,
          },
        });
        setBadges(badgeDetails);
        setAchievements(userAchievements);
      } catch (err) {
        console.error('Error fetching user data:', err);
        if (err.code === 'permission-denied') {
          setError('Permission denied. Please sign in again.');
        } else {
          setError('Failed to load profile data. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);

  const confirmLogout = async () => {
    try {
      await signOut(auth);
      navigateToLanding();
    } catch (err) {
      console.error('Logout error:', err);
      Alert.alert('Error', 'Failed to log out. Please try again.');
    }
  };

  if (loading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <CustomText style={twrnc`text-white mt-4`}>Loading Profile...</CustomText>
      </View>
    );
  }

  if (error) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center px-5`}>
        <FontAwesome name="exclamation-circle" size={48} color="#EF4444" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-white text-center mb-4`}>{error}</CustomText>
        <TouchableOpacity
          style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`}
          onPress={() => {
            setError(null);
            setLoading(true);
            fetchUserData();
          }}
        >
          <CustomText style={twrnc`text-white`}>Retry</CustomText>
        </TouchableOpacity>
      </View>
    );
  }

  const renderStatItem = (value, label) => (
    <View style={twrnc`items-center flex-1`} key={label}>
      <CustomText weight="bold" style={twrnc`text-white text-xl mb-1`}>{value}</CustomText>
      <CustomText style={twrnc`text-gray-400 text-xs`}>{label}</CustomText>
    </View>
  );

  const renderAchievementItem = ({ item }) => (
    <View key={item.id} style={twrnc`w-[48%] bg-[#2A2E3A] rounded-xl p-4 mb-4 items-center`}>
      <View
        style={twrnc`w-16 h-16 rounded-full mb-3 items-center justify-center ${item.completed ? 'bg-[#FFC107]' : 'bg-[#3A3F4B]'}`}
      >
        <CustomText style={twrnc`text-white text-2xl`}>{item.title[0]}</CustomText>
      </View>
      <CustomText weight="medium" style={twrnc`text-white text-center ${!item.completed && 'text-gray-500'}`}>
        {item.title}
      </CustomText>
    </View>
  );

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
  );

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <ScrollView style={twrnc`flex-1`}>
        <View style={twrnc`px-5 mt-4`}>
          <View style={twrnc`flex-row justify-between items-center mb-6`}>
            <TouchableOpacity onPress={navigateToDashboard}>
              <FontAwesome name="angle-left" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>Profile</CustomText>
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
              defaultSource={{ uri: 'https://randomuser.me/api/portraits/men/1.jpg' }}
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
          <CustomText weight="bold" style={twrnc`text-white text-2xl mb-1`}>{userData.username}</CustomText>
          <CustomText style={twrnc`text-gray-400 text-base`}>{userData.email}</CustomText>
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>Your Stats</CustomText>
          <View style={twrnc`flex-row justify-between bg-[#2A2E3A] rounded-xl p-4`}>
            {renderStatItem(userData.stats.totalDistance, 'Total Distance')}
            {renderStatItem(userData.stats.totalActivities, 'Activities')}
            {renderStatItem(userData.stats.longestRun, 'Longest Run')}
          </View>
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>Your Badges</CustomText>
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
                    defaultSource={{ uri: 'https://via.placeholder.com/80' }}
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
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>Achievements</CustomText>
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
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-4`}>Settings</CustomText>
          <View style={twrnc`bg-[#2A2E3A] rounded-xl`}>
            {settingsItems.map((item) => renderSettingItem(item))}
          </View>
        </View>
      </ScrollView>

      <CustomModal
        visible={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={confirmLogout}
        icon="sign-out"
        title="Confirm Logout"
        message="Are you sure you want to log out? Your progress will be saved automatically."
        type="warning"
      />
    </View>
  );
};

export default ProfileScreen;