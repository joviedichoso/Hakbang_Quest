import React, { useState, useEffect } from 'react';
import { View, ImageBackground, TouchableOpacity, ActivityIndicator } from 'react-native';
import twrnc from 'twrnc';
import CustomText from '../components/CustomText';

const LandingScreen = ({ navigateToSignIn, navigateToSignUp }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [buttonLoading, setButtonLoading] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsLoading(false);
        }, 1000); // Initial screen loading

        return () => clearTimeout(timer);
    }, []);

    const handleNavigate = (type) => {
        setButtonLoading(true);
        setTimeout(() => {
            setButtonLoading(false);
            if (type === 'signup') {
                navigateToSignUp();
            } else {
                navigateToSignIn();
            }
        }, 2000); 
    };

    return (
        <View style={twrnc`flex-1`}>
            <ImageBackground
                source={require('../assets/images/landing.png')}
                style={twrnc`flex-1 justify-end`}
                imageStyle={twrnc`opacity-80`}
            >
                {isLoading ? (
                    <View style={twrnc`flex-1 justify-center items-center`}>
                        <ActivityIndicator size="large" color="#4361EE" />
                    </View>
                ) : (
                    <View style={twrnc`p-5 pb-10`}>
                        <View style={twrnc`mb-8`}>
                            <CustomText
                                weight="bold"
                                style={twrnc`text-center text-3xl text-white mb-2`}
                            >
                                Workout that get better as you do
                            </CustomText>
                            <CustomText style={twrnc`text-center text-base text-white opacity-80`}>
                                Every step brings progress. Earn rewards, chart goals and unlock a better you.
                            </CustomText>
                        </View>

                        <View style={twrnc`items-center`}>
                            <TouchableOpacity
                                style={twrnc`bg-[#4361EE] py-4 rounded-lg w-full items-center mb-4`}
                                onPress={() => handleNavigate('signup')}
                                disabled={buttonLoading}
                            >
                                {buttonLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <CustomText
                                        weight="bold"
                                        style={twrnc`text-white text-base`}
                                    >
                                        Get Started
                                    </CustomText>
                                )}
                            </TouchableOpacity>

                            <View style={twrnc`flex-row items-center`}>
                                <CustomText style={twrnc`text-white opacity-80`}>
                                    Already have an account?{' '}
                                </CustomText>
                                <TouchableOpacity onPress={() => handleNavigate('signin')} disabled={buttonLoading}>
                                    {buttonLoading ? (
                                        <ActivityIndicator color="#FEC949" />
                                    ) : (
                                        <CustomText
                                            weight="bold"
                                            style={twrnc`text-[#FEC949]`}
                                        >
                                            Sign in
                                        </CustomText>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                )}
            </ImageBackground>
        </View>
    );
};

export default LandingScreen;
