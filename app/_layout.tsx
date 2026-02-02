import 'react-native-reanimated';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0f18' },
          headerTintColor: '#f5f7ff',
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: '#0a0f18' },
        }}>
        <Stack.Screen name="index" options={{ title: 'VeloRead' }} />
        <Stack.Screen name="setup/[bookId]" options={{ title: 'Reader Setup' }} />
        <Stack.Screen name="reader/[bookId]" options={{ title: 'Reader' }} />
      </Stack>
    </>
  );
}
