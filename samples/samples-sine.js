const [
  SAMPLES_SINE,
  SAMPLES_SINE_NOISE_8,
  SAMPLES_SINE_NOISE_33
] = function () {
  let seconds = 30
  let freq = 1
  let amp = 3
  let rate = 120

  let generate = (noiseAmp = 0) => {
    let t = 0
    let delta = 1 / rate
    let samples = []

    for (let s = 0; s <= seconds; s++) {
      for (let i = 0; i < rate; i++) {
        let value = Math.sin(t * 2 * Math.PI * freq) * amp
        value += (Math.random() * 2 - 1) * noiseAmp
        samples.push(value)
        t += delta
      }
    }

    return samples
  }

  let samplesNoise0 = generate()
  let samplesNoise8 = generate(amp * 0.08)
  let samplesNoise33 = generate(amp * 0.33)

  return [
    samplesNoise0,
    samplesNoise8,
    samplesNoise33
  ]
} ();
