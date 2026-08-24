/**
 * AppNavigator — main 4-tab shell (SRS §5.1). The Climate tab is shown only when the
 * Capabilities Manifest reports a heater or exhaust fan (KL-HEAT/CASE/PRO). Home,
 * Ambience and Settings are present on every variant.
 */
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../screens/HomeScreen';
import AmbienceScreen from '../screens/AmbienceScreen';
import AudioScreen from '../screens/AudioScreen';
import ClimateScreen from '../screens/ClimateScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useHasAudio, useHasClimateTab } from '../contexts/CapabilitiesContext';

const Tab = createBottomTabNavigator();

const icon = (emoji: string) => () => <Text style={{ fontSize: 18 }}>{emoji}</Text>;

export default function AppNavigator() {
  const showClimate = useHasClimateTab();
  const showAudio = useHasAudio();

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#c68f29' },
        headerTintColor: '#fff',
        tabBarActiveTintColor: '#ea580c',
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: icon('') }} />
      <Tab.Screen name="Ambience" component={AmbienceScreen} options={{ tabBarIcon: icon('💡') }} />
      {showAudio && (
        <Tab.Screen name="Audio" component={AudioScreen} options={{ tabBarIcon: icon('🔊') }} />
      )}
      {showClimate && (
        <Tab.Screen name="Climate" component={ClimateScreen} options={{ tabBarIcon: icon('🌡️') }} />
      )}
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: icon('⚙️') }} />
    </Tab.Navigator>
  );
}
