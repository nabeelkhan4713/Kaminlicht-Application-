/**
 * RootNavigator — switches between first-run provisioning and the main app based on
 * whether a fireplace has been paired (SRS §5.1).
 *
 * Unpaired → ProvisioningNavigator (BLE setup). Once provisioning confirms the device
 * is online over Wi-Fi it is written to DeviceStorage, the session flips to provisioned
 * and this swaps to the main tab shell automatically.
 */
import AppNavigator from './AppNavigator';
import ProvisioningNavigator from './ProvisioningNavigator';
import { useDeviceSession } from '../contexts/DeviceSessionContext';

export default function RootNavigator() {
  const { provisioned } = useDeviceSession();
  return provisioned ? <AppNavigator /> : <ProvisioningNavigator />;
}
