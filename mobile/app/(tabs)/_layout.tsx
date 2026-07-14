import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../../src/constants/colors';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

const TAB_ITEMS: { name: string; label: string; icon: IconName; iconFilled: IconName }[] = [
  { name: 'index',    label: 'HOME',    icon: 'dashboard',  iconFilled: 'dashboard' },
  { name: 'log',      label: 'LOG',     icon: 'history',    iconFilled: 'history' },
  { name: 'protocol', label: 'TRAIN',   icon: 'timer',      iconFilled: 'timer' },
  { name: 'profile',  label: 'PROFILE', icon: 'person',     iconFilled: 'person' },
];

function TabIcon({ focused, label, icon, iconFilled }: {
  focused: boolean; label: string; icon: IconName; iconFilled: IconName;
}) {
  return (
    <View style={styles.tabItem}>
      <MaterialIcons
        name={focused ? iconFilled : icon}
        size={22}
        color={focused ? Colors.cyan : Colors.outline}
        style={focused ? styles.iconGlow : undefined}
      />
      <Text style={[styles.tabLabel, { color: focused ? Colors.cyan : Colors.outline }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
      }}
    >
      {TAB_ITEMS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon
                focused={focused}
                label={tab.label}
                icon={tab.icon}
                iconFilled={tab.iconFilled}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'rgba(57,71,95,0.55)',
    borderTopColor: 'rgba(255,255,255,0.05)',
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 0,
    paddingTop: 0,
    shadowColor: Colors.cyan,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 20,
  },
  tabItem: { alignItems: 'center', gap: 2, paddingVertical: 6, width: 72 },
  tabLabel: { fontSize: 9, letterSpacing: 0.8, fontWeight: '600' },
  iconGlow: {
    shadowColor: Colors.cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
});
