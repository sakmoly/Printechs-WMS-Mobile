import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatusBadgeProps {
  status?: string | null;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  // Handle undefined/null status
  const safeStatus = status || 'Unknown';
  
  const getStatusColor = (status: string) => {
    if (!status) return '#757575';
    switch (status.toLowerCase()) {
      case 'pending':
        return '#FFA500'; // Orange
      case 'unloaded':
        return '#4CAF50';
      case 'receiving':
      case 'inreceiving': // Backward compatibility with old data
        return '#2196F3';
      case 'received':
        return '#9C27B0';
      case 'open':
        return '#4CAF50';
      case 'closed':
        return '#757575';
      case 'sealed':
        return '#FF9800';
      case 'dispatched':
        return '#4CAF50';
      case 'submitted':
        return '#2196F3';
      case 'in progress':
      case 'in_progress':
        return '#FF9800'; // Orange
      case 'picked':
        return '#4CAF50'; // Green
      case 'sealed':
        return '#9C27B0'; // Purple - distinct from other statuses
      case 'completed':
        return '#4CAF50';
      case 'draft':
        return '#9E9E9E'; // Gray
      case 'cancelled':
        return '#F44336'; // Red
      default:
        return '#757575';
    }
  };

  // Normalize status display text (for backward compatibility with old "InReceiving" data)
  const getDisplayStatus = (status: string): string => {
    if (!status) return 'Unknown';
    const normalized = status.toLowerCase();
    if (normalized === 'inreceiving') {
      return 'Receiving';
    }
    return status; // Return original status for all other cases
  };

  return (
    <View style={[styles.badge, { backgroundColor: getStatusColor(safeStatus) }]}>
      <Text style={styles.text}>{getDisplayStatus(safeStatus)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});

