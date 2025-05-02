import React, { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import CustomModal from '../components/CustomModal';
import { auth } from '../firebaseConfig';
import { signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
import { FontAwesome } from '@expo/vector-icons';

const LoginScreen = ({ navigateToLanding, navigateToSignUp, navigateToDashboard, prefilledEmail }) => {
  const [email, setEmail] = useState(prefilledEmail || '');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalType, setModalType] = useState('error');
  const [registeredEmails, setRegisteredEmails] = useState([]);
  const [userForVerification, setUserForVerification] = useState(null);

  useEffect(() => {
    const loadEmails = async () => {
      try {
        const storedEmails = await AsyncStorage.getItem('registeredEmails');
        if (storedEmails) {
          setRegisteredEmails(JSON.parse(storedEmails));
        }
      } catch (error) {
        console.error('Error loading emails from AsyncStorage:', error);
      }
    };
    loadEmails();
  }, []);

  useEffect(() => {
    setEmail(prefilledEmail || '');
  }, [prefilledEmail]);

  const handleEmailSignIn = async () => {
    let hasError = false;
    const newErrors = { email: '', password: '' };

    if (!email) {
      newErrors.email = 'Email is required';
      hasError = true;
    }
    if (!password) {
      newErrors.password = 'Password is required';
      hasError = true;
    }

    setErrors(newErrors);
    if (hasError) return;

    setIsLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      if (!user.emailVerified) {
        setModalTitle('Email Not Verified');
        setModalMessage('Please verify your email address to log in. Check your inbox for the verification email.');
        setModalType('error');
        setModalVisible(true);
        setUserForVerification(user);
      } else {
        navigateToDashboard();
      }
    } catch (error) {
      setModalTitle('Login Failed');
      setModalMessage(error.message);
      setModalType('error');
      setModalVisible(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!userForVerification) {
      setModalTitle('Error');
      setModalMessage('No user available to resend verification email.');
      setModalType('error');
      setModalVisible(true);
      return;
    }

    setIsLoading(true);
    try {
      await sendEmailVerification(userForVerification);
      setModalTitle('Verification Email Sent');
      setModalMessage('A new verification email has been sent to your email address.');
      setModalType('success');
      setModalVisible(true);
    } catch (error) {
      setModalTitle('Error');
      setModalMessage(error.message);
      setModalType('error');
      setModalVisible(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setModalTitle('Error');
      setModalMessage('Please enter your email to reset your password.');
      setModalType('error');
      setModalVisible(true);
      return;
    }
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setModalTitle('Password Reset Email Sent');
      setModalMessage('A password reset email has been sent to your email address.');
      setModalType('success');
      setModalVisible(true);
    } catch (error) {
      setModalTitle('Error');
      setModalMessage(error.message);
      setModalType('error');
      setModalVisible(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectEmail = (selectedEmail) => {
    setEmail(selectedEmail);
    setPassword('');
  };

  const handleModalClose = async () => {
    setModalVisible(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={twrnc`flex-1 bg-[#121826] p-5`}>
      <ScrollView contentContainerStyle={twrnc`flex-grow`} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={twrnc`self-start p-2`} onPress={navigateToLanding}>
          <CustomText style={twrnc`text-white text-xl`}>✕</CustomText>
        </TouchableOpacity>

        <View style={twrnc`flex-1 pt-10`}>
          <CustomText weight="bold" style={twrnc`text-5xl text-white mb-2`}>
            Sign in
          </CustomText>
          <CustomText style={twrnc`text-sm text-[#8E8E93] mb-6`}>
            Let's sign in to your HakbangQuest account
          </CustomText>

          {registeredEmails.length > 0 && (
            <View style={twrnc`mb-4`}>
              <CustomText style={twrnc`text-white mb-2`}>Registered Accounts</CustomText>
              <FlatList
                data={registeredEmails}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={twrnc`bg-[#1E2538] p-3 rounded-lg mb-2`}
                    onPress={() => handleSelectEmail(item)}
                  >
                    <CustomText style={twrnc`text-white`}>{item}</CustomText>
                  </TouchableOpacity>
                )}
                horizontal
                showsHorizontalScrollIndicator={false}
              />
            </View>
          )}

          <View style={twrnc`relative`}>
            <TextInput
              style={[
                twrnc`rounded-lg p-4 pr-12 text-white mb-4 ${isEmailFocused ? 'border-2 border-[#4361EE]' : 'bg-[#1E2538]'}`,
                { fontFamily: 'Poppins-Regular', fontSize: 16 },
              ]}
              placeholder="Email"
              placeholderTextColor="#8E8E93"
              value={email}
              onChangeText={setEmail}
              onFocus={() => setIsEmailFocused(true)}
              onBlur={() => setIsEmailFocused(false)}
              autoCapitalize="none"
            />
          </View>
          {errors.email ? <CustomText style={twrnc`text-red-500 mb-4`}>{errors.email}</CustomText> : null}

          <View style={twrnc`relative`}>
            <TextInput
              style={[
                twrnc`rounded-lg p-4 pr-12 text-white mb-4 ${isPasswordFocused ? 'border-2 border-[#4361EE]' : 'bg-[#1E2538]'}`,
                { fontFamily: 'Poppins-Regular', fontSize: 16 },
              ]}
              placeholder="Password"
              placeholderTextColor="#8E8E93"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!isPasswordVisible}
              onFocus={() => setIsPasswordFocused(true)}
              onBlur={() => setIsPasswordFocused(false)}
            />
            <TouchableOpacity
              style={twrnc`absolute right-3 top-4`}
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
            >
              <FontAwesome
                name={isPasswordVisible ? 'eye' : 'eye-slash'}
                size={20}
                color="#8E8E93"
              />
            </TouchableOpacity>
          </View>
          {errors.password ? <CustomText style={twrnc`text-red-500 mb-4`}>{errors.password}</CustomText> : null}

          <TouchableOpacity
            style={twrnc`bg-[#4361EE] py-4 rounded-lg items-center mt-2 mb-4`}
            onPress={handleEmailSignIn}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <CustomText weight="bold" style={twrnc`text-white text-base`}>
                Sign in
              </CustomText>
            )}
          </TouchableOpacity>

          <View style={twrnc`flex-row justify-center mb-6`}>
            <TouchableOpacity onPress={handleForgotPassword}>
              <CustomText style={twrnc`text-[#FEC949]`}>Forgot Password?</CustomText>
            </TouchableOpacity>
          </View>

          <View style={twrnc`flex-row justify-center`}>
            <CustomText style={twrnc`text-[#8E8E93]`}>Don't have an account? </CustomText>
            <TouchableOpacity onPress={navigateToSignUp}>
              <CustomText weight="bold" style={twrnc`text-[#FEC949]`}>Sign up</CustomText>
            </TouchableOpacity>
          </View>
        </View>

        <CustomModal
          visible={modalVisible}
          onClose={handleModalClose}
          onConfirm={modalTitle === 'Email Not Verified' ? handleResendVerification : handleModalClose}
          confirmText={modalTitle === 'Email Not Verified' ? 'Resend Verification' : 'OK'}
          icon={modalType === 'success' ? 'envelope' : 'exclamation-circle'}
          title={modalTitle}
          message={modalMessage}
          type={modalType}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default LoginScreen;