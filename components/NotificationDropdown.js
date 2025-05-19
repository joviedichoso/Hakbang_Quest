import React, { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Dimensions,
} from 'react-native';
import twrnc from 'twrnc';
import CustomText from './CustomText';
import { FontAwesome } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import NotificationService from '../services/NotificationService';
import { auth } from '../firebaseConfig';

const { height } = Dimensions.get('window');

// Helper function to format time
const formatTimeAgo = (date) => {
  if (!date) return '';
  
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
};

const NotificationDropdown = ({ 
  visible, 
  onClose, 
  navigateToActivity,
  navigateToCommunity
}) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markingAsRead, setMarkingAsRead] = useState(false);

  // Load notifications when dropdown is opened
  useEffect(() => {
    if (visible) {
      loadNotifications();
    }
  }, [visible]);

  // Load notifications from Firestore
  const loadNotifications = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) return;
      
      const notificationsData = await NotificationService.getNotifications(user.uid, 20);
      setNotifications(notificationsData);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  // Mark all notifications as read
  const handleMarkAllAsRead = async () => {
    try {
      setMarkingAsRead(true);
      const user = auth.currentUser;
      if (!user) return;
      
      await NotificationService.markAllAsRead(user.uid);
      
      // Update local state
      setNotifications(prev => 
        prev.map(notification => ({ ...notification, read: true }))
      );
    } catch (error) {
      console.error('Error marking all as read:', error);
    } finally {
      setMarkingAsRead(false);
    }
  };

  // Handle notification click
  const handleNotificationClick = async (notification) => {
    try {
      // Mark as read if not already read
      if (!notification.read) {
        await NotificationService.markAsRead(notification.id);
        
        // Update local state
        setNotifications(prev => 
          prev.map(n => n.id === notification.id ? { ...n, read: true } : n)
        );
      }
      
      // Navigate based on notification type
      switch (notification.type) {
        case 'friendRequest':
        case 'challenge':
        case 'message':
          navigateToCommunity();
          break;
        case 'activity':
          navigateToActivity();
          break;
        default:
          // Just close the dropdown for other types
          break;
      }
      
      // Close the dropdown
      onClose();
    } catch (error) {
      console.error('Error handling notification click:', error);
    }
  };

  // Get icon based on notification type
  const getNotificationIcon = (type) => {
    switch (type) {
      case 'friendRequest':
        return <Ionicons name="person-add" size={18} color="#4361EE" />;
      case 'challenge':
        return <FontAwesome name="trophy" size={18} color="#FFC107" />;
      case 'activity':
        return <MaterialCommunityIcons name="run" size={18} color="#06D6A0" />;
      case 'message':
        return <Ionicons name="chatbubble-ellipses" size={18} color="#4361EE" />;
      case 'system':
        return <Ionicons name="information-circle" size={18} color="#EF476F" />;
      default:
        return <Ionicons name="notifications" size={18} color="#4361EE" />;
    }
  };

  return (
    <Modal
      transparent={true}
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={twrnc`flex-1 bg-black bg-opacity-30`} 
        activeOpacity={1}
        onPress={onClose}
      >
        <View 
          style={twrnc`absolute top-16 right-4 w-80 max-h-[70%] bg-[#1E2538] rounded-xl shadow-lg`}
          onStartShouldSetResponder={() => true}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={twrnc`flex-row justify-between items-center p-4 border-b border-[#2A3447]`}>
            <CustomText weight="semibold" style={twrnc`text-white text-lg`}>
              Notifications
            </CustomText>
            <TouchableOpacity 
              onPress={handleMarkAllAsRead}
              disabled={markingAsRead || notifications.every(n => n.read)}
            >
              {markingAsRead ? (
                <ActivityIndicator size="small" color="#4361EE" />
              ) : (
                <CustomText 
                  style={twrnc`text-[#4361EE] ${notifications.every(n => n.read) ? 'opacity-50' : ''}`}
                >
                  Mark all read
                </CustomText>
              )}
            </TouchableOpacity>
          </View>
          
          {/* Notifications list */}
          {loading ? (
            <View style={twrnc`p-4 items-center`}>
              <ActivityIndicator size="large" color="#4361EE" />
              <CustomText style={twrnc`text-gray-400 mt-2`}>Loading notifications...</CustomText>
            </View>
          ) : notifications.length === 0 ? (
            <View style={twrnc`p-6 items-center`}>
              <Ionicons name="notifications-off-outline" size={40} color="#4361EE" />
              <CustomText style={twrnc`text-white text-center mt-2`}>
                No notifications yet
              </CustomText>
              <CustomText style={twrnc`text-gray-400 text-center mt-1 text-sm`}>
                We'll notify you when something happens
              </CustomText>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: height * 0.5 }}>
              {notifications.map(notification => (
                <TouchableOpacity
                  key={notification.id}
                  style={twrnc`p-3 border-b border-[#2A3447] ${notification.read ? '' : 'bg-[#2A2E3A]'}`}
                  onPress={() => handleNotificationClick(notification)}
                >
                  <View style={twrnc`flex-row items-center`}>
                    <View style={twrnc`w-8 h-8 rounded-full bg-[#121826] items-center justify-center mr-2`}>
                      {getNotificationIcon(notification.type)}
                    </View>
                    <View style={twrnc`flex-1`}>
                      <View style={twrnc`flex-row items-center justify-between`}>
                        <CustomText 
                          weight={notification.read ? "normal" : "semibold"} 
                          style={twrnc`text-white text-sm flex-1 mr-2`}
                          numberOfLines={1}
                        >
                          {notification.title || 'Notification'}
                        </CustomText>
                        <CustomText style={twrnc`text-gray-500 text-xs`}>
                          {formatTimeAgo(notification.createdAt)}
                        </CustomText>
                      </View>
                      <CustomText 
                        style={twrnc`text-gray-400 text-xs mt-1`}
                        numberOfLines={2}
                      >
                        {notification.message || 'No message'}
                      </CustomText>
                    </View>
                    {!notification.read && (
                      <View style={twrnc`w-2 h-2 rounded-full bg-[#4361EE] ml-1`} />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          
          {/* Footer */}
          <TouchableOpacity 
            style={twrnc`p-3 border-t border-[#2A3447] items-center`}
            onPress={onClose}
          >
            <CustomText style={twrnc`text-[#4361EE]`}>Close</CustomText>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

export default NotificationDropdown;
