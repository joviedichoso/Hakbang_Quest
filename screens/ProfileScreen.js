import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, ScrollView, Image, Modal, Pressable, FlatList, ActivityIndicator, Alert } from 'react-native';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import Icon from 'react-native-vector-icons/FontAwesome';
import { auth, db } from '../firebaseConfig';
import { signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

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

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          throw new Error('Not authenticated');
        }

        // Fetch user profile data
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        let username = 'User';
        if (userDoc.exists()) {
          username = userDoc.data().username || 'User';
        }

        // Fetch user activities
        const activitiesQuery = query(
          collection(db, 'activities'),
          where('userId', '==', user.uid)
        );
        const activitiesSnapshot = await getDocs(activitiesQuery);

        // Compute stats
        let totalDistance = 0;
        let totalActivities = 0;
        let longestRun = 0;

        activitiesSnapshot.forEach((doc) => {
          const activity = doc.data();
          totalDistance += activity.distance || 0;
          totalActivities += 1;
          longestRun = Math.max(longestRun, activity.distance || 0);
        });

        // Fetch user badges
        const badgesQuery = query(
          collection(db, 'userBadges'),
          where('userId', '==', user.uid)
        );
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

        // Fetch user achievements
        const achievementsQuery = query(
          collection(db, 'userAchievements'),
          where('userId', '==', user.uid)
        );
        const achievementsSnapshot = await getDocs(achievementsQuery);
        const userAchievements = achievementsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Update userData
        setUserData((prev) => ({
          ...prev,
          username,
          email: user.email || prev.email,
          avatar: userDoc.data()?.avatar || prev.avatar,
          stats: {
            totalDistance: `${totalDistance.toFixed(1)} km`,
            totalActivities: `${totalActivities}`,
            longestRun: `${longestRun.toFixed(1)} km`,
          },
        }));
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
        <Icon name="exclamation-circle" size={48} color="#EF4444" style={twrnc`mb-4`} />
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

  const renderStatItem = (value, label, iconName) => (
    <View style={twrnc`items-center flex-1`} key={label}>
      <View style={twrnc`flex-row items-center mb-1`}>
        <Icon name={iconName} size={14} color="#FFC107" style={twrnc`mr-1`} />
        <CustomText weight="bold" style={twrnc`text-white text-xl`}>{value}</CustomText>
      </View>
      <CustomText style={twrnc`text-gray-400 text-xs`}>{label}</CustomText>
    </View>
  );

  const renderAchievementItem = ({ item }) => (
    <View
      key={item.id}
      style={twrnc`w-[48%] bg-[#2A2E3A] rounded-xl p-4 mb-4 items-center`}
    >
      <View
        style={twrnc`w-16 h-16 rounded-full mb-3 items-center justify-center 
        ${item.completed ? 'bg-[#FFC107]' : 'bg-[#3A3F4B]'}`}
      >
        <Icon
          name={item.completed ? 'trophy' : 'lock'}
          size={24}
          color={item.completed ? '#121826' : '#FFFFFF'}
        />
      </View>
      <CustomText
        weight="medium"
        style={twrnc`text-white text-center ${!item.completed && 'text-gray-500'}`}
      >
        {item.title}
      </CustomText>
      {item.completed && (
        <Icon name="check-circle" size={16} color="#4ADE80" style={twrnc`mt-2`} />
      )}
    </View>
  );

  const renderSettingItem = (item) => (
    <TouchableOpacity
      key={item.id}
      style={twrnc`flex-row items-center p-4 border-b border-[#3A3F4B]`}
      onPress={item.action}
    >
      <View style={twrnc`bg-[${item.iconBg}] rounded-full p-2 mr-3`}>
        <Icon name={item.icon} size={18} color="#FFFFFF" />
      </View>
      <CustomText style={twrnc`text-white flex-1`}>{item.title}</CustomText>
      <Icon name="angle-right" size={20} color="#FFFFFF" />
    </TouchableOpacity>
  );

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <ScrollView style={twrnc`flex-1`}>
        <View style={twrnc`px-5 mt-4`}>
          <View style={twrnc`flex-row justify-between items-center mb-6`}>
            <TouchableOpacity onPress={navigateToDashboard}>
              <Icon name="angle-left" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>Profile</CustomText>
            <TouchableOpacity onPress={() => setShowLogoutModal(true)}>
              <Icon name="sign-out" size={24} color="#FFFFFF" />
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
            <View
              style={twrnc`absolute bottom-4 right-2 bg-[#4361EE] rounded-full p-1 border-2 border-[#121826]`}
            >
              <Icon name="pencil" size={12} color="#FFFFFF" />
            </View>
          </View>
          <CustomText weight="bold" style={twrnc`text-white text-2xl mb-1`}>
            {userData.username}
          </CustomText>
          <CustomText style={twrnc`text-gray-400 text-base`}>{userData.email}</CustomText>
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <View style={twrnc`flex-row justify-between items-center mb-4`}>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>Your Stats</CustomText>
            <Icon name="bar-chart" size={20} color="#FFC107" />
          </View>
          <View style={twrnc`flex-row justify-between bg-[#2A2E3A] rounded-xl p-4`}>
            {renderStatItem(userData.stats.totalDistance, 'Total Distance', 'map-marker')}
            {renderStatItem(userData.stats.totalActivities, 'Activities', 'history')}
            {renderStatItem(userData.stats.longestRun, 'Longest Run', 'flag-checkered')}
          </View>
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <View style={twrnc`flex-row justify-between items-center mb-4`}>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>Your Badges</CustomText>
            <Icon name="shield" size={20} color="#FFC107" />
          </View>
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
              <Icon name="exclamation-circle" size={24} color="#FFC107" style={twrnc`mb-2`} />
              <CustomText style={twrnc`text-gray-400`}>No badges earned yet</CustomText>
            </View>
          )}
        </View>

        <View style={twrnc`px-5 mb-8`}>
          <View style={twrnc`flex-row justify-between items-center mb-4`}>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>Achievements</CustomText>
            <Icon name="star" size={20} color="#FFC107" />
          </View>
          {achievements.length > 0 ? (
            <View style={twrnc`flex-row flex-wrap justify-between`}>
              {achievements.map((achievement) => renderAchievementItem({ item: achievement }))}
            </View>
          ) : (
            <View style={twrnc`bg-[#2A2E3A] rounded-xl p-4 items-center`}>
              <Icon name="exclamation-circle" size={24} color="#FFC107" style={twrnc`mb-2`} />
              <CustomText style={twrnc`text-gray-400`}>No achievements earned yet</CustomText>
            </View>
          )}
        </View>

        <View style={twrnc`px-5 mb-20`}>
          <View style={twrnc`flex-row justify-between items-center mb-4`}>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>Settings</CustomText>
            <Icon name="cog" size={20} color="#FFC107" />
          </View>
          <View style={twrnc`bg-[#2A2E3A] rounded-xl`}>
            {settingsItems.map((item) => renderSettingItem(item))}
          </View>
        </View>
      </ScrollView>

      <Modal
        transparent
        animationType="fade"
        visible={showLogoutModal}
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={twrnc`flex-1 justify-center items-center bg-black/80 p-4`}>
          <View
            style={twrnc`bg-[#121826] p-6 rounded-2xl w-full max-w-md border border-gray-800 shadow-lg shadow-black/50`}
          >
            <View style={twrnc`self-center mb-4`}>
              <View style={twrnc`bg-[#1F2937] p-5 rounded-full border border-gray-700/50`}>
                <CustomText style={twrnc`text-[30px]`}>✋</CustomText>
              </View>
            </View>
            <CustomText style={twrnc`text-white text-2xl font-bold text-center mb-2`}>
              Wait! Don't go yet
            </CustomText>
            <CustomText style={twrnc`text-gray-400 text-center mb-6 text-base leading-5`}>
              You're about to log out from your fitness journey.{'\n'}Your progress will be saved
              automatically.
            </CustomText>
            <View style={twrnc`flex-row justify-center gap-3`}>
              <Pressable
                onPress={() => setShowLogoutModal(false)}
                style={({ pressed }) =>
                  twrnc`bg-[#1F2937] px-6 py-3 rounded-xl flex-1 items-center border border-gray-700/50 ${
                    pressed ? 'bg-[#2A3748] opacity-90 scale-[0.98]' : ''
                  }`
                }
              >
                <CustomText style={twrnc`text-gray-300 font-medium`}>
                  <Icon name="times" size={16} color="#9CA3AF" style={twrnc`mr-2`} />
                  Cancel
                </CustomText>
              </Pressable>
              <Pressable
                onPress={confirmLogout}
                style={({ pressed }) =>
                  twrnc`bg-[#FFC107] px-6 py-3 rounded-xl flex-1 items-center justify-center ${
                    pressed ? 'bg-amber-400 opacity-90 scale-[0.98] shadow-inner' : 'shadow-md'
                  } shadow-black/30`
                }
              >
                <CustomText style={twrnc`text-gray-900 font-semibold`}>
                  <Icon name="sign-out" size={16} color="#1F2937" style={twrnc`mr-2`} />
                  Logout
                </CustomText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default ProfileScreen;