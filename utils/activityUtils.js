// utils/activityUtils.js
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  // Validate inputs
  if (
    lat1 == null || lon1 == null || lat2 == null || lon2 == null ||
    lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
    lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180
  ) {
    console.warn('Invalid coordinates provided to calculateDistance');
    return 0;
  }

  // If the coordinates are identical, return 0
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  // Haversine formula to calculate distance between two coordinates
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return parseFloat((R * c).toFixed(2)); // Distance in meters, rounded to 2 decimal places
};

export const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};