import React, { useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';
import CustomModal from '../components/CustomModal';
import { auth, db } from '../firebaseConfig';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { FontAwesome } from '@expo/vector-icons';

const SignupScreen = ({ navigateToLanding, navigateToSignIn, setIsInSignupFlow, setIsNavigationLocked }) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isUsernameFocused, setIsUsernameFocused] = useState(false);
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({ username: '', email: '', password: '' });
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalType, setModalType] = useState('success');

  useEffect(() => {
    if (modalVisible) {
      setIsNavigationLocked(true);
    } else {
      setIsNavigationLocked(false);
    }
  }, [modalVisible, setIsNavigationLocked]);

  const validateAndSignUp = async () => {
    const newErrors = { username: '', email: '', password: '' };
    let hasError = false;

    if (!username.trim()) {
      newErrors.username = 'Username is required';
      hasError = true;
    }

    if (!email.trim()) {
      newErrors.email = 'Email is required';
      hasError = true;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Invalid email format';
      hasError = true;
    }

    if (!password) {
      newErrors.password = 'Password is required';
      hasError = true;
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
      hasError = true;
    }

    setErrors(newErrors);
    if (!hasError) {
      await handleEmailSignUp();
    }
  };

  const handleEmailSignUp = async () => {
    setIsLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await setDoc(doc(db, 'users', user.uid), {
        username,
        email,
        createdAt: new Date(),
      });

      const storedEmails = await AsyncStorage.getItem('registeredEmails');
      const emails = storedEmails ? JSON.parse(storedEmails) : [];
      if (!emails.includes(email)) {
        emails.push(email);
        await AsyncStorage.setItem('registeredEmails', JSON.stringify(emails));
      }

      setModalTitle('Account Created');
      setModalMessage('Your account has been created. Please verify your email before logging in.');
      setModalType('success');
      setModalVisible(true);

      await sendEmailVerification(user);
    } catch (error) {
      setModalTitle('Sign Up Failed');
      setModalMessage(error.message);
      setModalType('error');
      setModalVisible(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModalClose = () => {
    setModalVisible(false);
    if (modalType === 'success') {
      navigateToSignIn(email); // Pass the email
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'andriod' ? 'padding' : 'height'} style={twrnc`flex-1 bg-[#121826] p-5`}>
      <ScrollView contentContainerStyle={twrnc`flex-grow`} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={twrnc`self-start p-2`} onPress={navigateToLanding}>
          <CustomText style={twrnc`text-white text-xl`}>✕</CustomText>
        </TouchableOpacity>

        <View style={twrnc`flex-1 pt-10`}>
          <CustomText weight="bold" style={twrnc`text-5xl text-white mb-2 leading-[60px]`}>
            Sign up
          </CustomText>
          <CustomText style={twrnc`text-sm text-[#8E8E93] mb-6`}>
            Let's create your HakbangQuest account
          </CustomText>

          <View style={twrnc`relative`}>
            <TextInput
              style={[
                twrnc`rounded-lg p-4 pr-12 text-white mb-4 ${isUsernameFocused ? 'border-2 border-[#4361EE]' : 'bg-[#1E2538]'}`,
                { fontFamily: 'Poppins-Regular', fontSize: 16 },
              ]}
              placeholder="Username"
              placeholderTextColor="#8E8E93"
              value={username}
              onChangeText={setUsername}
              onFocus={() => setIsUsernameFocused(true)}
              onBlur={() => setIsUsernameFocused(false)}
            />
          </View>
          {errors.username ? <CustomText style={twrnc`text-red-500 mb-4`}>{errors.username}</CustomText> : null}

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
            onPress={validateAndSignUp}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <CustomText weight="bold" style={twrnc`text-white text-base`}>
                Sign up
              </CustomText>
            )}
          </TouchableOpacity>

          <View style={twrnc`flex-row justify-center`}>
            <CustomText style={twrnc`text-[#8E8E93]`}>Already have an account? </CustomText>
            <TouchableOpacity onPress={() => navigateToSignIn()}>
              <CustomText weight="bold" style={twrnc`text-[#FEC949]`}>Sign in</CustomText>
            </TouchableOpacity>
          </View>
        </View>

        <CustomModal
          visible={modalVisible}
          title={modalTitle}
          message={modalMessage}
          onClose={handleModalClose}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default SignupScreen;