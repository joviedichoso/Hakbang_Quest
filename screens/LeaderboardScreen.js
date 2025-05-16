import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import Icon from 'react-native-vector-icons/FontAwesome';

import { db, auth } from '../firebaseConfig';
import { collection, query, getDocs } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

const LeaderboardScreen = ({ navigateToDashboard }) => {
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortMetric, setSortMetric] = useState('totalDistance');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const metrics = [
    { id: 'totalDistance', label: 'Total Distance', icon: 'map-marker' },
    { id: 'totalActivities', label: 'Total Activities', icon: 'history' },
    { id: 'longestRun', label: 'Longest Run', icon: 'flag-checkered' },
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      if (!user) {
        Alert.alert('Authentication Required', 'Please sign in to view the leaderboard.', [
          { text: 'OK', onPress: navigateToDashboard },
        ]);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [navigateToDashboard]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchLeaderboardData = async () => {
      try {
        setLoading(true);

        const usersSnapshot = await getDocs(query(collection(db, 'users')));
        const users = usersSnapshot.docs.map((doc) => ({
          uid: doc.id,
          username: doc.data().username || 'User',
        }));

        const activitiesSnapshot = await getDocs(query(collection(db, 'activities')));
        const userStats = {};

        activitiesSnapshot.forEach((doc) => {
          const activity = doc.data();
          const userId = activity.userId;
          if (!userStats[userId]) {
            userStats[userId] = {
              totalDistance: 0,
              totalActivities: 0,
              longestRun: 0,
            };
          }
          userStats[userId].totalDistance += activity.distance || 0;
          userStats[userId].totalActivities += 1;
          userStats[userId].longestRun = Math.max(userStats[userId].longestRun, activity.distance || 0);
        });

        const leaderboard = users
          .map((user) => ({
            username: user.username,
            ...userStats[user.uid],
            totalDistance: userStats[user.uid]?.totalDistance || 0,
            totalActivities: userStats[user.uid]?.totalActivities || 0,
            longestRun: userStats[user.uid]?.longestRun || 0,
          }))
          .filter((user) => user.totalActivities > 0)
          .sort((a, b) => b[sortMetric] - a[sortMetric]);

        setLeaderboardData(leaderboard);
      } catch (err) {
        console.error('Error fetching leaderboard data:', err);
        Alert.alert('Error', 'Failed to load leaderboard. Please try again later.', [
          { text: 'OK', onPress: navigateToDashboard },
        ]);
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboardData();
  }, [isAuthenticated, sortMetric, navigateToDashboard]);

  const handleMetricChange = (metric) => {
    setSortMetric(metric);
  };

  const renderLeaderboardItem = ({ item, index }) => {
    const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32'];

    const rankEmoji = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';

    return (
      <View
        style={twrnc`flex-row items-center p-4 bg-[#1E222A] rounded-xl shadow-lg mb-3 mx-4 border border-[#3A3F4B]`}
      >
        {/* Rank Badge with emoji */}
        <View
          style={twrnc`w-14 h-14 items-center justify-center rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 shadow-md`}
        >
          <CustomText
            weight="bold"
            style={twrnc`text-white text-2xl`}
          >
            {index < 3 ? (index === 0 ? '🏆' : index === 1 ? '🥈' : '🥉') : `${index + 1}`}
          </CustomText>
        </View>

        {/* User Info */}
        <View style={twrnc`flex-1 ml-4`}>
          <CustomText style={twrnc`text-white text-lg font-semibold`}>
            {item.username}
          </CustomText>
          <View style={twrnc`mt-1`}>
            <CustomText style={twrnc`text-gray-400 text-sm`}>
              Distance: {item.totalDistance.toFixed(1)} km
            </CustomText>
            <CustomText style={twrnc`text-gray-400 text-sm`}>
              Activities: {item.totalActivities}
            </CustomText>
            <CustomText style={twrnc`text-gray-400 text-sm`}>
              Longest Run: {item.longestRun.toFixed(1)} km
            </CustomText>
          </View>
        </View>
        {/* Medal emoji for top 3 */}
        {index < 3 && (
          <CustomText style={twrnc`ml-2 text-2xl`}>
            {index === 0 ? '🏆' : index === 1 ? '🥈' : '🥉'}
          </CustomText>
        )}
      </View>
    );
  };

  const renderMetricButton = (metric) => (
    <TouchableOpacity
      key={metric.id}
      style={twrnc`flex-row items-center bg-[#3A3F4B] rounded-xl px-3 py-2 mx-1 ${sortMetric === metric.id ? 'bg-[#4361EE]' : ''
        }`}
      onPress={() => handleMetricChange(metric.id)}
    >
      <Icon name={metric.icon} size={16} color="#FFFFFF" style={twrnc`mr-2`} />
      <CustomText style={twrnc`text-white text-sm`}>{metric.label}</CustomText>
    </TouchableOpacity>
  );

  if (!isAuthenticated) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center px-5`}>
        <Icon name="lock" size={48} color="#FFC107" style={twrnc`mb-4`} />
        <CustomText style={twrnc`text-white text-center mb-4`}>
          Please sign in to view the leaderboard.
        </CustomText>
        <TouchableOpacity
          style={twrnc`bg-[#4361EE] px-4 py-2 rounded-lg`}
          onPress={navigateToDashboard}
        >
          <CustomText style={twrnc`text-white`}>Back to Dashboard</CustomText>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={twrnc`flex-1 bg-[#121826] justify-center items-center`}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <CustomText style={twrnc`text-white mt-4`}>Loading Leaderboard...</CustomText>
      </View>
    );
  }

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      {/* Header */}
      <View
        style={twrnc`flex-row justify-between items-center px-5 py-4 border-b border-[#3A3F4B]`}
      >
        <TouchableOpacity onPress={navigateToDashboard}>
          <Icon name="angle-left" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <CustomText style={twrnc`text-white text-lg font-semibold`}>
          Leaderboard
        </CustomText>
        <View style={twrnc`w-7`} />
      </View>

      {/* Metric Selector */}
      <View style={twrnc`flex-row justify-center my-4 px-5`}>
        {metrics.map((metric) => renderMetricButton(metric))}
      </View>

      {/* Leaderboard List or No Data */}
      {leaderboardData.length > 0 ? (
        <FlatList
          data={leaderboardData}
          keyExtractor={(item, index) => `${item.username}-${index}`}
          renderItem={renderLeaderboardItem}
          contentContainerStyle={twrnc`pb-20`}
        />
      ) : (
        <View style={twrnc`flex-1 justify-center items-center px-5`}>
          <Icon name="exclamation-circle" size={48} color="#FFC107" style={twrnc`mb-4`} />
          <CustomText style={twrnc`text-gray-400 text-center`}>
            No activities found. Start tracking to join!
          </CustomText>
        </View>
      )}
    </View>
  );
};

export default LeaderboardScreen;