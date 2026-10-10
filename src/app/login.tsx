import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { getCompanyLogo } from '../utils/companyBranding';
import { CompanyProfile, getCompanyProfile } from '../database/db'
import { Image } from 'expo-image';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [company, setCompany] = useState<CompanyProfile>(getCompanyProfile());

  const handleLogin = async (id?: string, pass?: string) => {
    const loginId = id ?? username;
    const loginPass = pass ?? password;

    if (!loginId.trim() || !loginPass) {
      setErrorMessage('Please enter your username and password.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const result = await login(loginId, loginPass);
      if (result.success) {
        if (result.message) {
          Alert.alert('Notice', result.message);
        }
        router.replace('/');
      } else {
        setErrorMessage(result.message || 'Login failed. Please check your credentials.');
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'An unexpected error occurred during login.');
    } finally {
      setLoading(false);
    }
  };



  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-slate-900"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
        className="px-6 py-10"
      >
        {/* Header Branding */}
        <View className="items-center mb-8">
          <Image
            source={require('../../assets/SoftAir_SFA.png')}
            style={{ width: 240, height: 75 }}
            contentFit="contain"
          />
        </View>

        {/* Card Container */}
        <View className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 shadow-2xl">
          <Text className="text-lg font-bold text-white mb-1">Welcome</Text>
          <Text className="text-xs text-slate-400 mb-5">
            Sign in to start your field route
          </Text>

          {/* Error Message */}
          {errorMessage ? (
            <View className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3.5 mb-4 flex-row items-center gap-2">
              <MaterialIcons name="error-outline" size={20} color="#f43f5e" />
              <Text className="text-xs text-rose-300 font-medium flex-1">
                {errorMessage}
              </Text>
            </View>
          ) : null}

          {/* Username / Email Input */}
          <Text className="text-xs font-semibold text-slate-300 mb-1.5 ml-1">
            Username
          </Text>
          <View className="flex-row items-center bg-slate-900/90 border border-slate-700 rounded-2xl px-4 py-3 mb-4 focus:border-blue-500">
            <MaterialIcons name="person-outline" size={20} color="#94a3b8" />
            <TextInput
              value={username}
              onChangeText={text => {
                setUsername(text);
                setErrorMessage('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 ml-3 text-sm text-white"
            />
            {username.length > 0 && (
              <TouchableOpacity onPress={() => setUsername('')}>
                <MaterialIcons name="close" size={18} color="#64748b" />
              </TouchableOpacity>
            )}
          </View>

          {/* Password Input */}
          <Text className="text-xs font-semibold text-slate-300 mb-1.5 ml-1">
            Password
          </Text>
          <View className="flex-row items-center bg-slate-900/90 border border-slate-700 rounded-2xl px-4 py-3 mb-6 focus:border-blue-500">
            <MaterialIcons name="lock-outline" size={20} color="#94a3b8" />
            <TextInput
              value={password}
              onChangeText={text => {
                setPassword(text);
                setErrorMessage('');
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              className="flex-1 ml-3 text-sm text-white"
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <MaterialIcons
                name={showPassword ? 'visibility' : 'visibility-off'}
                size={20}
                color="#94a3b8"
              />
            </TouchableOpacity>
          </View>

          {/* Sign In Button */}
          <TouchableOpacity
            onPress={() => handleLogin()}
            disabled={loading}
            className="bg-blue-600 active:bg-blue-700 py-4 rounded-2xl items-center flex-row justify-center shadow-lg shadow-blue-600/30"
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <>
                <Text className="text-white font-bold text-base mr-2">Sign In</Text>
                <MaterialIcons name="arrow-forward" size={20} color="#ffffff" />
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Copyright info below card */}
        <View className="mt-8 items-center justify-center">
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              try {
                Linking.openURL('https://www.softair.co.in');
              } catch (_) { }
            }}
          >
            <Text className="text-xs text-slate-400 font-medium">
              Copyright @ 2026 | www.softair.co.in
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
