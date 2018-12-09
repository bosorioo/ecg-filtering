/// The macro DEBUG can be defined to make Arduino send
/// various text messages with debug info.
//#define DEBUG

/// The macro USE_GENERATED_SINE can be defined to make
/// this code generate a sine wave with noise as input
/// for the filter instead of reading data from the
/// analog port.
//#define USE_GENERATED_SINE

/// The macro below defines from which analog port
/// the ECG circuit output readings will be made
#define INPUT_ANALOG_PORT A0

#define NL_MEANS_WINDOW_SIZE 21
#define NL_MEANS_TEMPLATE_SIZE 7
#define NL_MEANS_H 0.005
#define printVar(var) Serial.print(#var " = "); Serial.println(var);

const double SINE_FREQUENCY_HZ = 1.;
const double SINE_AMPLITUDE = 3.;
const double NOISE_AMPLITUDE = 3.;
const double PI_TWO = 6.283185307179;

// Some pre calculated values for performance
const double _AMPLITUDE_MAX = SINE_AMPLITUDE + NOISE_AMPLITUDE;
const double _H_TIMES_2_INV_NEG = -1. / (NL_MEANS_H * NL_MEANS_H);
const int _NL_WINDOW_FULL_SIZE = NL_MEANS_WINDOW_SIZE + NL_MEANS_TEMPLATE_SIZE - 1;
const int _NL_WINDOW_CENTER_INDEX = _NL_WINDOW_FULL_SIZE >> 1;
const int _NL_TEMPLATE_SIZE_HALF = NL_MEANS_TEMPLATE_SIZE >> 1;

// Generates a random value in the range (-amplitude, amplitude)
double noiseGenerator(double amplitude) {
  return amplitude * (((double)random(0xFFFF) / 0xFFFF) * 2.0 - 1.0);
}

// Generates a sine wave, based on the in-board timing
double sineGenerator(double amplitude, double frequencyHz) {
  double sineValue = sin(millis() * 1e-3 * PI_TWO * frequencyHz) * amplitude;
  return sineValue;
}

// Converts a floating point value to an integer in the range [0, 1023].
unsigned long toDiscrete(double value, double amplitude_max) {
  return (unsigned long)(((value + amplitude_max) * 0.5f) / amplitude_max * 1023.f);
}

struct NLMeansFilterS {
  double buffer[_NL_WINDOW_FULL_SIZE];
  int samples;
};

typedef struct NLMeansFilterS NLMeansFilter;

struct NLMeansFilterS createNlMeansFilter() {
  NLMeansFilter filter;
  filter.samples = 0;
  for (int index = 0; index < NL_MEANS_WINDOW_SIZE + NL_MEANS_TEMPLATE_SIZE; index++) {
    filter.buffer[index] = 0.;
  }
  return filter;
}

double filterNlMeans(struct NLMeansFilterS* filter, double sampleIn) {
#ifdef DEBUG
  Serial.println("-- FILTER BEGIN --");
  printVar(filter->samples);
#endif

  if (filter->samples >= _NL_WINDOW_FULL_SIZE) {
    for (int index = 0; index < filter->samples - 1; index++) {
      filter->buffer[index] = filter->buffer[index + 1];
    }
    filter->buffer[filter->samples - 1] = sampleIn;
  } else {
    filter->buffer[filter->samples] = sampleIn;

#ifdef DEBUG
    filter->samples++;
    return sampleIn;
#endif
  }

#ifdef DEBUG
    for (int index = 0; index < filter->samples; index++) {
      Serial.print("samples[");
      Serial.print(index);
      Serial.print("] = ");
      Serial.println(filter->buffer[index]);
    }
#endif

  double centerWeight = 0.;

  for (int index = -_NL_TEMPLATE_SIZE_HALF; index <= _NL_TEMPLATE_SIZE_HALF; index++) {
    centerWeight += filter->buffer[_NL_WINDOW_CENTER_INDEX + index];
  }

#ifdef DEBUG
  printVar(centerWeight);
#endif

  centerWeight /= NL_MEANS_TEMPLATE_SIZE;

#ifdef DEBUG
  printVar(centerWeight);
#endif

  double totalWeights = 0.;
  double totalWeighted = 0.;

  for (int i = 0; i < NL_MEANS_WINDOW_SIZE; i++) {
    const int sampleIndex = _NL_WINDOW_FULL_SIZE - 1 - i - _NL_TEMPLATE_SIZE_HALF;
    double sample = filter->buffer[sampleIndex];
    double weight = 0.;

#ifdef DEBUG
    Serial.print("window step ");
    Serial.print(i);
    Serial.print(", sampleIndex = ");
    Serial.print(sampleIndex);
    Serial.print(", sample = ");
    Serial.println(sample);
#endif

    for (int j = -_NL_TEMPLATE_SIZE_HALF; j <= _NL_TEMPLATE_SIZE_HALF; j++) {
      weight += filter->buffer[sampleIndex + j];
    }
#ifdef DEBUG
    printVar(weight)
#endif

    weight /= (double)NL_MEANS_TEMPLATE_SIZE;

#ifdef DEBUG
    printVar(weight)
#endif

    weight -= centerWeight;

#ifdef DEBUG
    printVar(weight)
#endif

    weight = exp(_H_TIMES_2_INV_NEG * weight * weight);

#ifdef DEBUG
    printVar(weight)
#endif

    totalWeights += weight;
    totalWeighted += weight * sample;

#ifdef DEBUG
    printVar(totalWeights)
    printVar(totalWeighted)
#endif
  }

#ifdef DEBUG
  printVar(totalWeights);
  printVar(totalWeighted);
#endif

  if (filter->samples < _NL_WINDOW_FULL_SIZE) {
    filter->samples++;
  }

  double sampleOut = totalWeighted / totalWeights;

#ifdef DEBUG
  printVar(sampleIn);
  printVar(sampleOut);
  Serial.println("-- FILTER END --");
#endif
  return sampleOut;
}

NLMeansFilter filter = createNlMeansFilter();

void setup() {
  Serial.begin(9600);
  // Reads unconnected analog ports to get some random values
  const int seed = (analogRead(A7) & 0x2AA) | (analogRead(A8) & 0x155);
  randomSeed(seed);

#ifdef DEBUG
  Serial.println("-- INITIALIZATION --");
  Serial.println(_NL_WINDOW_FULL_SIZE);
  Serial.println(_NL_WINDOW_CENTER_INDEX);
  Serial.println(_NL_TEMPLATE_SIZE_HALF);
  Serial.println(_H_TIMES_2_INV_NEG);
#endif
}

void loop() {
#ifdef USE_GENERATED_SINE
  const double noise = noiseGenerator(NOISE_AMPLITUDE);
  const double sine = sineGenerator(SINE_AMPLITUDE, SINE_FREQUENCY_HZ);
  const double sample = noise + sine;
#else
  int sensorValue = analogRead(INPUT_ANALOG_PORT);
  const double sample = sensorValue * 5.0 / 1023.;
#endif

  const double filteredSample = filterNlMeans(&filter, sample);

  const unsigned long outputDiscrete = toDiscrete(filteredSample, _AMPLITUDE_MAX);

#ifndef DEBUG
  Serial.println(outputDiscrete);
#endif
}
