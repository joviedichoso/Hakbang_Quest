import React, { useEffect } from 'react';
import { Modal, View, TouchableOpacity } from 'react-native';
import twrnc from 'twrnc';
import { FontAwesome } from '@expo/vector-icons';
import CustomText from './CustomText';

const CustomModal = ({ visible, onClose, onConfirm, icon, title, message, type = 'success' }) => {
  useEffect(() => {
  }, [message, title, type, visible]);

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={twrnc`flex-1 justify-center items-center bg-black/50`}>
        <View style={twrnc`bg-[#1E2538] rounded-xl p-6 w-5/6 max-w-md shadow-lg`}>
          <View style={twrnc`items-center mb-4`}>
            <View 
              style={twrnc`w-16 h-16 rounded-full items-center justify-center mb-4 ${
                type === 'success' ? 'bg-green-100' : 'bg-red-100'
              }`}
            >
              <FontAwesome 
                name={icon || (type === 'success' ? 'check' : 'exclamation-circle')} 
                size={32} 
                color={type === 'success' ? '#10B981' : '#EF4444'} 
              />
            </View>
            <CustomText weight="bold" style={twrnc`text-xl text-white mb-2`}>
              {title}
            </CustomText>
            <CustomText style={twrnc`text-gray-300 text-center`}>
              {message}
            </CustomText>
          </View>
          <TouchableOpacity
            style={twrnc`bg-[#4361EE] py-3 rounded-lg items-center mt-4`}
            onPress={onConfirm || onClose}
          >
            <CustomText weight="bold" style={twrnc`text-white`}>
              OK
            </CustomText>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default CustomModal;