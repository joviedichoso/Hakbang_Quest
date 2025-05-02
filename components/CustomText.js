import React from 'react';
import { Text } from 'react-native';

export const CustomText = ({ 
  children, 
  style, 
  weight = 'regular', 
  ...props 
}) => {
  let fontFamily;
  
  switch (weight) {
    case 'medium':
      fontFamily = 'Poppins-Medium';
      break;
    case 'semibold':
      fontFamily = 'Poppins-SemiBold';
      break;
    case 'bold':
      fontFamily = 'Poppins-Bold';
      break;
    default:
      fontFamily = 'Poppins-Regular';
  }

  return (
    <Text 
      style={[{ fontFamily }, style]} 
      {...props}
    >
      {children}
    </Text>
  );
};

export default CustomText;