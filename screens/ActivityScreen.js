import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, Image, Switch, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import Icon from 'react-native-vector-icons/FontAwesome';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';

// Import icons
import WalkingIcon from '../components/icons/walking.png';
import RunningIcon from '../components/icons/running.png';
import CyclingIcon from '../components/icons/cycling.png';
import JoggingIcon from '../components/icons/jogging.png';

const ActivityScreen = ({ navigateToDashboard, navigateToMap, params = {} }) => {
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(params.activityType || 'walking');
  const [distance, setDistance] = useState(params.distance || '5.00');
  const [time, setTime] = useState(params.time || '30');
  const [calories, setCalories] = useState(0);
  const [coordinates, setCoordinates] = useState(params.coordinates || []);
  const [stats, setStats] = useState(
    params.stats || {
      distance: 0,
      duration: 0,
      pace: 0,
      avgSpeed: 0,
    }
  );

  const [challenges, setChallenges] = useState([]);
  const [challengeLoading, setChallengeLoading] = useState(true);

  const activities = [
    { id: 'walking', name: 'Walking', icon: WalkingIcon, met: 3.5, color: '#4361EE', iconColor: '#FFFFFF' },
    { id: 'running', name: 'Running', icon: RunningIcon, met: 8.0, color: '#EF476F', iconColor: '#FFFFFF' },
    { id: 'cycling', name: 'Cycling', icon: CyclingIcon, met: 6.0, color: '#06D6A0', iconColor: '#121826' },
    { id: 'jogging', name: 'Jogging', icon: JoggingIcon, met: 7.0, color: '#FFD166', iconColor: '#121826' },
  ];

  const calculateCalories = () => {
    const weight = 70; // Default weight in kg
    const timeInHours = (parseFloat(time) || 0) / 60;
    const activity = activities.find((a) => a.id === selectedActivity);
    const kcal = (activity?.met || 3.5) * weight * timeInHours;
    return Math.round(kcal);
  };

  const calculateTargetDistance = () => {
    const timeInHours = (parseFloat(time) || 0) / 60;
    const speeds = { walking: 5, running: 10, cycling: 15, jogging: 8 };
    return (timeInHours * (speeds[selectedActivity] || 5)).toFixed(2);
  };

  useEffect(() => {
    setCalories(calculateCalories());
  }, [selectedActivity, time]);

  useEffect(() => {
    if (params?.activityType && selectedActivity !== params.activityType) {
      setDistance(calculateTargetDistance());
    }
  }, [selectedActivity, time]);

  useEffect(() => {
    const fetchChallenges = async () => {
      try {
        const challengesRef = collection(db, 'challenges');
        const challengesSnapshot = await getDocs(challengesRef);
        const challengesData = challengesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setChallenges(challengesData);
        setChallengeLoading(false);
      } catch (err) {
        console.error('Error fetching challenges:', err);
        setChallengeLoading(false);
      }
    };

    fetchChallenges();
  }, []);

  const handleDistanceChange = (value) => {
    if (/^\d*\.?\d{0,2}$/.test(value) || value === '') {
      setDistance(value);
    }
  };

  const startActivity = () => {
    const activityConfig = activities.find((a) => a.id === selectedActivity);
    if (!gpsEnabled) {
      alert('GPS Tracking is disabled. Please enable it to start the activity.');
      return;
    }
    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: distance,
      targetTime: time,
      tracking: false, // MapScreen will handle starting the tracking
      initialCoordinates: [],
      initialStats: { distance: 0, duration: 0, pace: 0, avgSpeed: 0 },
    });
  };

  const resumeTracking = () => {
    const activityConfig = activities.find((a) => a.id === selectedActivity);
    navigateToMap({
      activityType: selectedActivity,
      activityColor: activityConfig.color,
      targetDistance: distance,
      targetTime: time,
      tracking: true,
      initialCoordinates: coordinates,
      initialStats: stats,
    });
  };

  const clearActivity = () => {
    setCoordinates([]);
    setStats({ distance: 0, duration: 0, pace: 0, avgSpeed: 0 });
  };

  return (
    <View style={twrnc`flex-1 bg-[#121826]`}>
      <View style={twrnc`flex-row items-center p-5 bg-[#121826] border-b border-[#2A2E3A]`}>
        <TouchableOpacity style={twrnc`mr-4 z-10`} onPress={navigateToDashboard}>
          <Icon name="angle-left" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={twrnc`absolute left-0 right-0 items-center justify-center p-5`}>
          <CustomText weight="semibold" style={twrnc`text-white text-xl`}>
            {activities.find((a) => a.id === selectedActivity)?.name || 'Activity'}
          </CustomText>
        </View>
      </View>

      <ScrollView contentContainerStyle={twrnc`p-5 pb-20`} style={twrnc`flex-1`}>
        {/* Activity Selection */}
        <View style={twrnc`mb-6`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-3`}>
            Select Activity
          </CustomText>
          <View style={twrnc`flex-row flex-wrap justify-between`}>
            {activities.map((activity) => (
              <TouchableOpacity
                key={activity.id}
                style={[
                  twrnc`rounded-xl p-4 items-center mb-4`,
                  {
                    backgroundColor: selectedActivity === activity.id ? activity.color : '#2A2E3A',
                    width: '48%',
                  },
                ]}
                onPress={() => setSelectedActivity(activity.id)}
              >
                <Image
                  source={activity.icon}
                  resizeMode="contain"
                  style={[
                    twrnc`w-10 h-10 mb-2`,
                    { tintColor: selectedActivity === activity.id ? activity.iconColor : '#FFFFFF' },
                  ]}
                />
                <CustomText
                  weight="medium"
                  style={{ color: selectedActivity === activity.id ? activity.iconColor : '#FFFFFF' }}
                >
                  {activity.name}
                </CustomText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Challenges Section */}
        <View style={twrnc`mb-6`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-3`}>
            Challenges
          </CustomText>
          {challengeLoading ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : (
            challenges.map((challenge) => {
              const progress = Math.min(
                (challenge.unit === 'steps'
                  ? stats.steps
                  : parseFloat(distance)) / challenge.goal,
                1
              );

              return (
                <View
                  key={challenge.id}
                  style={twrnc`bg-[#2A2E3A] rounded-xl p-4 mb-4`}
                >
                  <View style={twrnc`flex-row justify-between items-center mb-2`}>
                    <CustomText weight="bold" style={twrnc`text-white text-base`}>
                      {challenge.title}
                    </CustomText>
                    <CustomText style={twrnc`text-[#FFC107] text-sm`}>
                      {Math.round(progress * 100)}%
                    </CustomText>
                  </View>
                  <CustomText style={twrnc`text-gray-400 text-sm mb-2`}>
                    {challenge.description}
                  </CustomText>
                  <View style={twrnc`h-2 bg-[#3A3F4B] rounded-full`}>
                    <View
                      style={[
                        twrnc`h-2 rounded-full`,
                        {
                          width: `${progress * 100}%`,
                          backgroundColor: progress >= 1 ? '#4CAF50' : '#FFC107',
                        },
                      ]}
                    />
                  </View>
                  <CustomText
                    style={twrnc`text-xs text-gray-400 mt-2`}
                  >
                    {challenge.unit === 'steps'
                      ? `${Math.min(stats.steps, challenge.goal)}/${challenge.goal} steps`
                      : `${Math.min(parseFloat(distance), challenge.goal).toFixed(2)}/${challenge.goal} km`}
                  </CustomText>
                </View>
              );
            })
          )}
        </View>

        {/* Activity Settings */}
        <View style={twrnc`mb-6`}>
          <CustomText weight="semibold" style={twrnc`text-white text-lg mb-3`}>
            Activity Settings
          </CustomText>
          {/* Distance Input */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-3`}>
            <View style={twrnc`flex-row justify-between items-center p-4`}>
              <CustomText style={twrnc`text-white`}>Distance (km)</CustomText>
              <TextInput
                style={twrnc`text-white text-lg bg-[#3A3F4B] rounded px-3 py-2 w-24 text-right`}
                value={distance}
                onChangeText={handleDistanceChange}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor="#888"
              />
            </View>
          </View>

          {/* Duration Input */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-3 p-4`}>
            <CustomText style={twrnc`text-white mb-3`}>Duration (minutes)</CustomText>
            <View style={twrnc`flex-row flex-wrap justify-between`}>
              {[10, 20, 30, 45, 60, 90].map((mins) => (
                <TouchableOpacity
                  key={mins}
                  style={[
                    twrnc`w-[30%] mb-3 py-2 rounded-lg items-center`,
                    time === mins.toString()
                      ? {
                          backgroundColor:
                            activities.find((a) => a.id === selectedActivity)?.color || '#4361EE',
                        }
                      : { backgroundColor: '#3A3F4B' },
                  ]}
                  onPress={() => setTime(mins.toString())}
                >
                  <CustomText style={twrnc`text-white`}>{mins}</CustomText>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* GPS Tracking */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl mb-3`}>
            <View style={twrnc`flex-row justify-between items-center p-4`}>
              <View style={twrnc`flex-row items-center`}>
                <FontAwesome name="map-marker" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
                <CustomText style={twrnc`text-white`}>GPS Tracking</CustomText>
              </View>
              <Switch
                trackColor={{ false: '#3A3F4B', true: '#4361EE' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#3A3F4B"
                onValueChange={setGpsEnabled}
                value={gpsEnabled}
              />
            </View>
          </View>

          {/* Auto-Pause */}
          <View style={twrnc`bg-[#2A2E3A] rounded-xl`}>
            <View style={twrnc`flex-row justify-between items-center p-4`}>
              <View style={twrnc`flex-row items-center`}>
                <FontAwesome name="pause" size={20} color="#FFFFFF" style={twrnc`mr-2`} />
                <CustomText style={twrnc`text-white`}>Auto-Pause</CustomText>
              </View>
              <Switch
                trackColor={{ false: '#3A3F4B', true: '#4361EE' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#3A3F4B"
                onValueChange={setAutoPauseEnabled}
                value={autoPauseEnabled}
              />
            </View>
          </View>
        </View>

        {/* Start/Resume Activity */}
        <View style={twrnc`mt-4`}>
          {coordinates.length > 0 ? (
            <>
              <TouchableOpacity
                style={[
                  twrnc`rounded-xl py-4 items-center mb-3`,
                  { backgroundColor: activities.find((a) => a.id === selectedActivity)?.color || '#4361EE' },
                ]}
                onPress={resumeTracking}
              >
                <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                  Resume Activity
                </CustomText>
              </TouchableOpacity>
              <TouchableOpacity
                style={twrnc`border border-[#EF476F] rounded-xl py-4 items-center`}
                onPress={clearActivity}
              >
                <CustomText weight="bold" style={twrnc`text-[#EF476F] text-lg`}>
                  Clear Activity
                </CustomText>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[
                twrnc`rounded-xl py-4 items-center`,
                { backgroundColor: activities.find((a) => a.id === selectedActivity)?.color || '#4361EE' },
              ]}
              onPress={startActivity}
            >
              <CustomText weight="bold" style={twrnc`text-white text-lg`}>
                Start Activity
              </CustomText>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

export default ActivityScreen;