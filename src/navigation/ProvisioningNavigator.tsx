/**
 * ProvisioningNavigator — the first-run setup shell (SRS §5.1).
 * Shown while no fireplace is paired; there is nothing to close back to, so the
 * provisioning screen is rendered full-screen without a close button. It swaps
 * itself out via RootNavigator as soon as the device is saved.
 */
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ProvisioningScreen from '../screens/ProvisioningScreen';

export default function ProvisioningNavigator() {
  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.container}>
        <ProvisioningScreen />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});
