import '../global.css';
import React, { useEffect, useRef, useState } from 'react';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { View, Text, TouchableOpacity, Platform, ScrollView, Dimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { startLiveGpsTracking, stopLiveGpsTracking } from '../services/gpsTrackingService';

import { Image } from 'expo-image';

function ScrollableTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets?.bottom || 0, Platform.OS === 'android' ? 14 : 8);
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);

  const currentRoute = state.routes[state.index];
  const currentDescriptor = descriptors[currentRoute?.key];

  // Filter out non-tab screens (like login)
  const visibleRoutes = state.routes.filter((route: any) => {
    const { options } = descriptors[route.key];
    return options.href !== null && options.tabBarStyle?.display !== 'none';
  });

  const activeVisibleIndex = visibleRoutes.findIndex((r: any) => r.key === currentRoute?.key);

  useEffect(() => {
    // Automatically smooth scroll active tab into view
    if (activeVisibleIndex >= 0 && scrollRef.current && containerWidth > 0) {
      const itemApproxWidth = 84;
      const targetX = Math.max(
        0,
        activeVisibleIndex * itemApproxWidth - (containerWidth / 2 - itemApproxWidth / 2)
      );
      scrollRef.current.scrollTo({ x: targetX, animated: true });
    }
  }, [activeVisibleIndex, containerWidth]);

  // Completely hide the tab bar on login screen or screens configured with tabBarStyle: { display: 'none' }
  const isHidden =
    !currentRoute ||
    currentRoute.name === 'login' ||
    currentDescriptor?.options?.tabBarStyle?.display === 'none' ||
    currentDescriptor?.options?.href === null;

  if (isHidden) {
    return null;
  }

  const canScrollLeft = scrollX > 12;
  const canScrollRight = contentWidth > containerWidth && scrollX < contentWidth - containerWidth - 12;

  const scrollLeft = () => {
    scrollRef.current?.scrollTo({ x: Math.max(0, scrollX - 160), animated: true });
  };

  const scrollRight = () => {
    scrollRef.current?.scrollTo({ x: scrollX + 160, animated: true });
  };

  return (
    <View
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      style={{
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e2e8f0',
        paddingBottom: bottomInset,
        paddingTop: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', position: 'relative' }}>
        {/* Left scroll chevron helper */}
        {canScrollLeft && (
          <TouchableOpacity
            onPress={scrollLeft}
            hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
            style={{
              position: 'absolute',
              left: 2,
              zIndex: 20,
              backgroundColor: '#ffffff',
              borderRadius: 16,
              width: 26,
              height: 26,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: '#e2e8f0',
              shadowColor: '#000',
              shadowOffset: { width: 1, height: 1 },
              shadowOpacity: 0.12,
              shadowRadius: 2,
              elevation: 4,
            }}
          >
            <MaterialIcons name="chevron-left" size={20} color="#208AEF" />
          </TouchableOpacity>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces={true}
          overScrollMode="always"
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
          scrollEventThrottle={16}
          onContentSizeChange={(w) => setContentWidth(w)}
          contentContainerStyle={{
            paddingHorizontal: 12,
            alignItems: 'center',
            flexDirection: 'row',
          }}
        >
          {visibleRoutes.map((route: any) => {
            const { options } = descriptors[route.key];
            const isFocused = route.key === currentRoute?.key;

            const label =
              options.tabBarLabel !== undefined
                ? options.tabBarLabel
                : options.title !== undefined
                ? options.title
                : route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const activeColor = '#208AEF';
            const inactiveColor = '#64748b';
            const color = isFocused ? activeColor : inactiveColor;

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarButtonTestID}
                onPress={onPress}
                onLongPress={onLongPress}
                activeOpacity={0.7}
                style={{
                  minWidth: 76,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  backgroundColor: isFocused ? '#eff6ff' : 'transparent',
                  marginHorizontal: 3,
                  borderWidth: isFocused ? 1 : 0,
                  borderColor: isFocused ? '#bfdbfe' : 'transparent',
                }}
              >
                {options.tabBarIcon ? (
                  options.tabBarIcon({ focused: isFocused, color, size: 22 })
                ) : null}
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 11,
                    fontWeight: isFocused ? '700' : '500',
                    color,
                    marginTop: 2,
                  }}
                >
                  {typeof label === 'string' ? label : route.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Right scroll chevron helper */}
        {canScrollRight && (
          <TouchableOpacity
            onPress={scrollRight}
            hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
            style={{
              position: 'absolute',
              right: 2,
              zIndex: 20,
              backgroundColor: '#ffffff',
              borderRadius: 16,
              width: 26,
              height: 26,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: '#e2e8f0',
              shadowColor: '#000',
              shadowOffset: { width: -1, height: 1 },
              shadowOpacity: 0.12,
              shadowRadius: 2,
              elevation: 4,
            }}
          >
            <MaterialIcons name="chevron-right" size={20} color="#208AEF" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function TabsNavigation() {
  const { user, isLoading, logout } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const isLoginPage = segments[0] === 'login';

    if (!user && !isLoginPage) {
      stopLiveGpsTracking();
      router.replace('/login');
    } else if (user && isLoginPage) {
      startLiveGpsTracking(20000);
      router.replace('/');
    } else if (user) {
      startLiveGpsTracking(20000);
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return (
      <LoadingIndicator
        fullScreen
        showLogo
        message="Sales Force Automation"
        subtitle="by SoftAir Solutions"
        subtext="Synchronizing offline catalog and user profile..."
      />
    );
  }

  return (
    <Tabs
      tabBar={(props) => <ScrollableTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: '#208AEF',
        tabBarInactiveTintColor: '#64748b',
        headerTitleAlign: 'center',
        headerTitleStyle: {
          fontSize: 15,
          fontWeight: '700',
          color: '#0f172a',
        },
        headerLeft: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 16 }}>
            <Image
              source={require('../../assets/SoftAir_SFA.png')}
              style={{ width: 34, height: 34 }}
              contentFit="contain"
            />
          </View>
        ),
        headerRight: () =>
          user ? (
            <TouchableOpacity
              onPress={async () => {
                await logout();
                router.replace('/login');
              }}
              className="mr-4 flex-row items-center gap-1.5 bg-slate-100 py-1 px-2.5 rounded-full"
            >
              <Text className="text-xs font-semibold text-slate-700">
                {user.name?.split(' ')[0] || user.username}
              </Text>
              <MaterialIcons name="logout" size={16} color="#ef4444" />
            </TouchableOpacity>
          ) : null,
      }}
    >
      <Tabs.Screen
        name="login"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <MaterialIcons name="dashboard" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: 'Invoices & Orders',
          tabBarLabel: 'Invoices',
          tabBarIcon: ({ color }) => <MaterialIcons name="receipt" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stocks"
        options={{
          title: 'Stocks',
          tabBarIcon: ({ color }) => <MaterialIcons name="inventory-2" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color }) => <MaterialIcons name="account-balance-wallet" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color }) => <MaterialIcons name="assessment" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Customers',
          tabBarIcon: ({ color }) => <MaterialIcons name="people" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <MaterialIcons name="settings" size={23} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <TabsNavigation />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
