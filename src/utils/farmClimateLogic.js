export const calculateDailyGDD = (tmax, tmin, baseTemp = 10) => {
  const avgTemp = (tmax + tmin) / 2;
  return Math.max(0, avgTemp - baseTemp);
};

export const resolveStage = (crop, cumulativeGdd) => {
  const cropLower = crop.trim().toLowerCase();

  if (cropLower === 'mango') {
    if (cumulativeGdd < 300) return 'Vegetative';
    if (cumulativeGdd < 600) return 'Flower Initiation';
    if (cumulativeGdd < 900) return 'Flowering';
    if (cumulativeGdd < 1200) return 'Fruit Set';
    return 'Maturity';
  }

  if (cropLower === 'cashew') {
    if (cumulativeGdd < 250) return 'Vegetative';
    if (cumulativeGdd < 500) return 'Flowering';
    if (cumulativeGdd < 850) return 'Nut Set';
    return 'Maturity';
  }

  return 'Unknown';
};

export const analyzeRisks = (sensorData, crop, stageInput = null, isHighMoistureDays = false) => {
  const warnings = [];
  const {
    Air_Temperature: temp,
    Humidity: rh,
    Leaf_wetness: leafWetness,
    Lux: lux,
    Rain_mm: rain,
    Wind_speed: windSpeed,
    Soil_Moisture: soilMoisture,
  } = sensorData;

  const stage = stageInput ? stageInput.trim().toLowerCase() : '';
  const cropName = crop.trim().toLowerCase();

  if (temp >= 38) {
    warnings.push({
      type: 'HEAT_STRESS',
      level: 'HIGH',
      message: 'Severe heat stress detected (≥ 38°C).',
    });
  } else if (temp >= 35) {
    warnings.push({
      type: 'HEAT_STRESS',
      level: 'MEDIUM',
      message: 'Moderate heat stress detected (35–38°C).',
    });
  } else if (temp <= 10) {
    warnings.push({
      type: 'COLD_STRESS',
      level: 'HIGH',
      message: 'Cold stress detected (≤ 10°C). Risk of flower/bud damage.',
    });
  }

  const isFog = rh > 90 && lux < 2000 && leafWetness >= 4;

  if (windSpeed > 10 || rain > 0 || isFog || temp > 35) {
    const reasons = [];
    if (windSpeed > 10) reasons.push('High wind');
    if (rain > 0) reasons.push('Rain detected');
    if (isFog) reasons.push('Fog');
    if (temp > 35) reasons.push('High Temp');

    warnings.push({
      type: 'SPRAY',
      level: 'HIGH',
      message: `Do NOT Spray: ${reasons.join(', ')}.`,
    });
  }

  const currentHour = new Date().getHours();
  if (
    windSpeed < 7
    && rh >= 60 && rh <= 80
    && temp >= 18 && temp <= 30
    && lux >= 3000 && lux <= 15000
    && currentHour >= 9 && currentHour < 11
  ) {
    warnings.push({
      type: 'SPRAY_WINDOW',
      level: 'LOW',
      message: 'Best Spray Window Detected (Ideal Temp, RH, Wind & Light).',
    });
  }

  if (isFog && stage.includes('flowering')) {
    warnings.push({
      type: 'FLOWER_DROP',
      level: 'HIGH',
      message: 'High risk of flower drop due to fog.',
    });
  }

  if (stage.includes('flower')) {
    if (windSpeed > 12 || rain > 2 || rh > 90) {
      warnings.push({
        type: 'POLLINATION_FAILURE',
        level: 'HIGH',
        message: 'Risk of Pollination Failure (High wind/rain/humidity). Poor fruit set expected.',
      });
    }
  }

  if (soilMoisture < 20) {
    warnings.push({
      type: 'IRRIGATION',
      level: 'HIGH',
      message: 'Low soil moisture! Do irrigation to dryness of soil.',
    });
  }

  if (soilMoisture > 75 && isHighMoistureDays) {
    warnings.push({
      type: 'ROOT_STRESS',
      level: 'HIGH',
      message: 'Root rot risk detected (Soil Moisture > 75% for 3+ days).',
    });
  }

  if (cropName === 'mango') {
    if (stage.includes('flower')) {
      if (temp >= 10 && temp <= 25 && rh >= 60 && rh <= 80 && rain === 0 && lux < 4000) {
        warnings.push({
          type: 'DISEASE',
          level: 'HIGH',
          message: 'High risk of Powdery Mildew. Preventive spray recommended.',
        });
      }
    }

    if (temp >= 25 && temp <= 30 && rh > 90 && leafWetness > 8) {
      warnings.push({
        type: 'DISEASE',
        level: 'HIGH',
        message: 'High risk of Anthracnose due to continuous wetness.',
      });
    }

    if (stage.includes('flower')) {
      if (temp >= 20 && temp <= 30 && rh < 70 && lux > 15000) {
        warnings.push({
          type: 'PEST',
          level: 'HIGH',
          message: 'High risk of Mango Hopper.',
        });
      }
    }

    if (stage.includes('maturity')) {
      if (temp >= 25 && temp <= 35 && rh > 60 && rh < 80 && rain > 0) {
        warnings.push({
          type: 'PEST',
          level: 'HIGH',
          message: 'High risk of Fruit Fly (Pre-harvest).',
        });
      }
    }

    if (stage.includes('vegetative')) {
      if (soilMoisture < 50) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Soil moisture low (< 50%) for Vegetative stage.',
        });
      } else if (soilMoisture > 75) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Excess soil moisture (> 75%) for Vegetative stage.',
        });
      }
    } else if (stage.includes('flowering') || stage.includes('flower')) {
      if (soilMoisture > 60) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Excess soil moisture (> 60%) during Flowering. Risk of flower drop.',
        });
      }
    } else if (stage.includes('fruit set') || stage.includes('fruit')) {
      if (soilMoisture < 50) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Soil moisture low (< 50%) for Fruit Set stage.',
        });
      }
    } else if (stage.includes('maturity')) {
      if (soilMoisture > 60) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Excess soil moisture (> 60%) during Maturity.',
        });
      }
    }
  }

  if (cropName === 'cashew') {
    if (stage.includes('flowering') || stage.includes('vegetative')) {
      if (temp >= 24 && temp <= 30 && rh >= 65 && rh <= 85 && lux >= 8000 && lux <= 20000 && rain > 0) {
        warnings.push({
          type: 'PEST',
          level: 'HIGH',
          message: 'High risk of Tea Mosquito Bug.',
        });
      }
    }

    if (temp >= 28 && temp <= 35 && rh >= 60 && rh <= 80 && soilMoisture > 80) {
      warnings.push({
        type: 'PEST',
        level: 'HIGH',
        message: 'Conditions favorable for Stem & Root Borer (High temps + Waterlogging).',
      });
    }

    if (temp >= 25 && temp <= 30 && rh >= 90 && rain >= 2) {
      warnings.push({
        type: 'DISEASE',
        level: 'HIGH',
        message: 'High risk of Anthracnose / Dieback (High humidity + Rain).',
      });
    }

    if (stage.includes('vegetative')) {
      if (soilMoisture < 55) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Soil moisture low (< 55%) for Vegetative stage.',
        });
      } else if (soilMoisture > 65) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Excess soil moisture (> 65%) for Vegetative stage.',
        });
      }
    } else if (stage.includes('flowering')) {
      if (soilMoisture < 45) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Soil moisture low (< 45%) for Flowering stage.',
        });
      } else if (soilMoisture > 55) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Excess soil moisture (> 55%) for Flowering stage.',
        });
      }
    } else if (stage.includes('nut')) {
      if (soilMoisture < 60) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Soil moisture low (< 60%) for Nut Set stage.',
        });
      } else if (soilMoisture > 70) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Excess soil moisture (> 70%) for Nut Set stage.',
        });
      }
    } else if (stage.includes('maturity')) {
      if (soilMoisture < 40) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Soil moisture low (< 40%) for Maturity stage.',
        });
      } else if (soilMoisture > 50) {
        warnings.push({
          type: 'IRRIGATION',
          level: 'HIGH',
          message: 'Excess soil moisture (> 50%) during Maturity.',
        });
      }
    }
  }

  return warnings;
};
