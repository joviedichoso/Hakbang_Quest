// utils/routeGenerator.js
import polyline from '@mapbox/polyline';
import { GOOGLE_MAPS_API_KEY } from '@env';

export const generateRoute = async (startLocation, targetDistance, activityType) => {
  if (!startLocation) {
    console.error('No start location provided');
    return null;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY is not defined in .env');
    return null;
  }

  try {
    const { latitude, longitude } = startLocation;
    const mode = activityType === 'cycling' ? 'BICYCLE' : 'WALK'; // Routes API modes

    const potentialDestinations = generatePotentialDestinations(latitude, longitude, targetDistance);

    let bestRoute = null;
    let closestDistanceDiff = Infinity;

    for (const dest of potentialDestinations) {
      const route = await fetchRouteFromGoogleRoutes(
        { latitude, longitude },
        dest,
        mode,
        true, // Try loop first
      );
      if (route) {
        const routeDistance = route.distance / 1000; // Convert meters to km
        const distanceDiff = Math.abs(routeDistance - targetDistance);
        if (distanceDiff < closestDistanceDiff) {
          closestDistanceDiff = distanceDiff;
          bestRoute = route;
        }
      }
    }

    if (!bestRoute || closestDistanceDiff > targetDistance * 0.3) {
      const dest = potentialDestinations[0];
      bestRoute = await fetchRouteFromGoogleRoutes(
        { latitude, longitude },
        dest,
        mode,
        false, // Out-and-back
      );
    }

    if (!bestRoute) {
      console.error('No valid route found after all attempts');
      return null;
    }

    const coordinates = bestRoute.coordinates;
    const routeDistance = bestRoute.distance / 1000;
    const difficulty = routeDistance <= 5 ? 'easy' : routeDistance <= 10 ? 'moderate' : 'hard';

    const waypoints = [
      {
        latitude: coordinates[0].latitude,
        longitude: coordinates[0].longitude,
        name: 'Start',
        type: 'start',
      },
      {
        latitude: coordinates[Math.floor(coordinates.length / 2)].latitude,
        longitude: coordinates[Math.floor(coordinates.length / 2)].longitude,
        name: 'Midpoint',
        type: 'waypoint',
      },
      {
        latitude: coordinates[coordinates.length - 1].latitude,
        longitude: coordinates[coordinates.length - 1].longitude,
        name: 'Finish',
        type: 'end',
      },
    ];

    return {
      id: `generated-${Date.now()}`,
      name: `${activityType.charAt(0).toUpperCase() + activityType.slice(1)} Route`,
      coordinates,
      waypoints,
      distance: Number.parseFloat(routeDistance.toFixed(2)),
      difficulty,
      description: `A ${difficulty} ${routeDistance.toFixed(2)} km route for ${activityType}`,
      routeType: bestRoute.isLoop ? 'loop' : 'out-and-back',
    };
  } catch (error) {
    console.error('Error generating route:', error);
    return null;
  }
};

const generatePotentialDestinations = (startLat, startLng, targetDistance) => {
  const destinations = [];
  const numDirections = 4;
  const kmToDegrees = 1 / 111.139;
  const routeRadius = (targetDistance / 2) * kmToDegrees;

  for (let i = 0; i < numDirections; i++) {
    const angle = (i / numDirections) * 2 * Math.PI;
    const latFactor = Math.cos(startLat * (Math.PI / 180));
    const dest = {
      latitude: startLat + routeRadius * Math.sin(angle),
      longitude: startLng + (routeRadius * Math.cos(angle)) / latFactor,
    };
    destinations.push(dest);
  }

  return destinations;
};

const fetchRouteFromGoogleRoutes = async (start, destination, mode, tryLoop) => {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
    'X-Goog-FieldMask': 'routes.distanceMeters,routes.polyline.encodedPolyline', // Request only needed fields
  };

  const body = {
    origin: {
      location: {
        latLng: { latitude: start.latitude, longitude: start.longitude },
      },
    },
    destination: tryLoop
      ? {
          location: {
            latLng: { latitude: start.latitude, longitude: start.longitude },
          },
        }
      : {
          location: {
            latLng: { latitude: destination.latitude, longitude: destination.longitude },
          },
        },
    intermediates: tryLoop
      ? [
          {
            location: {
              latLng: { latitude: destination.latitude, longitude: destination.longitude },
            },
          },
        ]
      : [],
    travelMode: mode,
    routingPreference: 'TRAFFIC_AWARE', // Optimize for traffic
    computeAlternativeRoutes: false,
    units: 'METRIC',
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await response.json();

    if (data.error) {
      console.warn('Google Routes API error:', data.error.code, data.error.message);
      return null;
    }

    const route = data.routes[0];
    if (!route) {
      console.warn('No routes returned by Google Routes API');
      return null;
    }

    const points = polyline.decode(route.polyline.encodedPolyline);
    const coordinates = points.map(([latitude, longitude]) => ({
      latitude,
      longitude,
    }));

    const distance = route.distanceMeters;

    return {
      coordinates,
      distance,
      isLoop: tryLoop && coordinates[0].latitude === coordinates[coordinates.length - 1].latitude,
    };
  } catch (error) {
    console.error('Error fetching route from Google Routes:', error);
    return null;
  }
};