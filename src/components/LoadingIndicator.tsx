import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';

interface LoadingIndicatorProps {
  message?: string;
  subtitle?: string;
  byLine?: string;
  subtext?: string;
  fullScreen?: boolean;
  color?: string;
  iconName?: keyof typeof MaterialIcons.glyphMap;
  showLogo?: boolean;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Loading...',
  subtitle,
  byLine,
  subtext = 'Please wait a moment',
  fullScreen = false,
  color = '#38bdf8',
  iconName = 'point-of-sale',
  showLogo = true,
}) => {
  const displaySubtitle = subtitle || byLine;

  if (fullScreen) {
    return (
      <View className="flex-1 bg-slate-900 justify-center items-center px-6">
        {/* Brand Logo or Icon Badge */}
        {showLogo ? (
          <View className="w-20 h-20 rounded-2xl bg-white/10 border border-sky-400/25 items-center justify-center mb-6 p-2 shadow-lg shadow-black/40 overflow-hidden">
            <Image
              source={require('../../assets/SoftAir_SFA.png')}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
            />
          </View>
        ) : (
          <View className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 items-center justify-center mb-5">
            <MaterialIcons name={iconName} size={32} color={color} />
          </View>
        )}

        {/* Spinner */}
        <ActivityIndicator size="large" color={color} className="mb-5" />

        {/* Title Details */}
        <Text className="text-white text-lg font-bold tracking-tight text-center">
          {message}
        </Text>

        {/* Subtitle / Underneath Byline (small size) */}
        {displaySubtitle ? (
          <Text className="text-sky-400 text-xs font-semibold tracking-wider mt-1 text-center">
            {displaySubtitle}
          </Text>
        ) : null}

        {/* Subtext (sync / status info) */}
        {subtext ? (
          <Text className="text-slate-400 text-xs font-medium mt-3 text-center">
            {subtext}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="py-12 px-6 items-center justify-center">
      <View className="w-12 h-12 rounded-xl bg-blue-50 items-center justify-center mb-3">
        <ActivityIndicator size="small" color="#2563eb" />
      </View>
      <Text className="text-slate-700 text-sm font-semibold text-center">
        {message}
      </Text>
      {displaySubtitle ? (
        <Text className="text-sky-600 text-xs font-medium mt-0.5 text-center">
          {displaySubtitle}
        </Text>
      ) : null}
      {subtext ? (
        <Text className="text-slate-400 text-xs mt-1 text-center">
          {subtext}
        </Text>
      ) : null}
    </View>
  );
};

export default LoadingIndicator;

