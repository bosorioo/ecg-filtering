const btnPlayPause = document.querySelector('#btnPlayPause')
const chart = echarts.init(document.querySelector('#main'))

const SAMPLES_SOURCE_INDEX = 0
const SAMPLES_SOURCES = [
  {
    data: SAMPLES_RAW,
    rate: 120
  },
  {
    data: SAMPLES_aami3a,
    rate: 720
  }
]

const DISPLAY_FEED_SIZE = 12
const DISPLAY_UPDATE_TIME_FACTOR = 1

const SAMPLES_SOURCE = SAMPLES_SOURCES[SAMPLES_SOURCE_INDEX]

const SAMPLES = SAMPLES_SOURCE.data
const SAMPLE_RATE = SAMPLES_SOURCE.rate

const DISPLAY_SAMPLES_MAX = SAMPLE_RATE * 3
const DISPLAY_BEGIN_X = 0 * 1e-3 * SAMPLE_RATE

const X_AXIS_RANGE = DISPLAY_SAMPLES_MAX / SAMPLE_RATE * 1000

let isPlaying = true
let lastSampleAdded = DISPLAY_BEGIN_X

function sampleIndexToMs (index) {
  return index * 1000 / SAMPLE_RATE
}

let filters = [
  {
    name: 'raw',
    handler (incomingSample, raw, output) {
      output.push(incomingSample)
    }
  },
  {
    // taken from https://www.megunolink.com/articles/3-methods-filter-noisy-arduino-measurements/
    name: 'exp-filter',
    handler (incomingSample, raw, output) {
      let w = 0.45
      if (output.length === 0) {
        output.push([
          incomingSample[0],
          incomingSample[1],
        ])
      } else {
        output.push([
          incomingSample[0],
          incomingSample[1] * w + output[output.length - 1][1] * (1 - w),
        ])
      }
    }
  },
  {
    // Chebyshev Type 2 FIR
    name: 'cheby2-8',
    handler (incomingSample, raw, output) {
      const N = 8
      const A = [1,-5.64737797273014,14.2191712744666,-20.7845222563753,19.2510054679411,-11.5511646917874,4.37940372345248,-0.958208975534196,0.0925573026794671]
      const B = [0.000383459377501092,-0.000727179462469762,0.00119864571559651,-0.00100393780101283,0.00116189645333627,-0.00100393780101283,0.00119864571559651,-0.000727179462469763,0.000383459377501093]

      let outputValue = raw[raw.length - 1][1] * B[0]

      for (let index = 1; index <= N; index++) {
        let sample = raw[raw.length - 1 - index]
        if (sample) {
          outputValue += B[index] * sample[1]
        }
        sample = output[output.length - index]
        if (sample) {
          outputValue -= A[index] * sample[1]
        }
      }

      outputValue /= A[0]

      output.push([
        incomingSample[0],
        outputValue
      ])
    }
  },
  {
    name: 'nl-means',
    handler (incomingSample, raw, output) {
      const windowSize = 21
      const templateWindowSize = 7
      if (raw.length < windowSize + templateWindowSize - 1) {
        return
      }
      const h = 0.005
      const h2InvNeg = -1 / (h * h)
      const centerIndex = raw.length - (windowSize + templateWindowSize) * 0.5

      let centerWeight = 0

      for (let wi = 0; wi < templateWindowSize; wi++) {
        centerWeight += raw[centerIndex + wi - (templateWindowSize - 1) * 0.5][1]
      }

      centerWeight /= templateWindowSize

      let totalWeights = 0
      let totalWeighted = 0

      for (let index = 0; index < windowSize; index++) {
        let sampleIndex = raw.length - 1 - index - (templateWindowSize - 1) * 0.5
        let sample = raw[sampleIndex]
        let weight = 0
        for (let wi = 0; wi < templateWindowSize; wi++) {
          weight += raw[sampleIndex + wi - (templateWindowSize - 1) * 0.5][1]
        }
        weight /= templateWindowSize
        weight = Math.exp(h2InvNeg * (weight - centerWeight) * (weight - centerWeight))
        totalWeights += weight
        totalWeighted += weight * sample[1]
      }

      let sampleValue = totalWeighted / totalWeights

      output.push([
        raw[centerIndex][0],
        sampleValue
      ])
    }
  },
  {
    // taken from https://www.megunolink.com/articles/3-methods-filter-noisy-arduino-measurements/
    name: 'running-avg',
    handler (incomingSample, raw, output) {
      let avg = 0
      let avgDiv = 0
      let range = 3
      for (let shift = -range; shift <= 0; shift++) {
        let sample = raw[raw.length + shift]
        if (sample) {
          avgDiv++
          avg += sample[1]
        }
      }
      output.push([
        incomingSample[0],
        avg / avgDiv
      ])
    }
  }
]
.map(f => Object.assign(f, { data: [] }))

let samplesDisplay = []
let chartOption = {
  animation: false,
  legend: {
    data: filters.map(f => f.name)
  },
  /* visualMap: [
    {
      show: false,
      type: 'continuous',
      seriesIndex: 0,
      min: 1.5,
      max: 4.5
    },
    {
      show: false,
      type: 'continuous',
      seriesIndex: 1,
      inRange: {
        color: [ 'rgba(38, 104, 255, 0.5)', 'rgba(38, 104, 255, 1)' ]
      },
      min: 1.5,
      max: 4.5
    }
  ], */
  xAxis: {
    type: 'value',
    min: DISPLAY_BEGIN_X,
    max: DISPLAY_BEGIN_X + X_AXIS_RANGE,
    // minInterval: 1000
  },
  yAxis: {
    type: 'value',
    min: Math.floor(SAMPLES.reduce((acc, v) => acc > v ? v : acc) * 100 - 0.1) / 100,
    max: Math.ceil(SAMPLES.reduce((acc, v) => acc < v ? v : acc) * 100 + 0.1) / 100
  },
  series: filters.map(f => {
    return {
      symbol: 'none',
      type: 'line',
      data: f.data,
      name: f.name,
      stack: f.stack,
      sampling: 'max',
      animation: false
    }
  })
}

function zeroPad (num, length = 3) {
  num = String(num)
  if (num.length < length) {
    num = '0'.repeat(length - num.length) + num
  }
  return num
}

function updateDisplay (xAxisIndexInit) {
  if (samplesDisplay.length > 0) {
    // chartOption.xAxis.min = samplesDisplay[0][0]
    // chartOption.xAxis.max = samplesDisplay[0][0] + X_AXIS_RANGE

    let base = Math.max(0, samplesDisplay[samplesDisplay.length - 1][0] - X_AXIS_RANGE)
    chartOption.xAxis.min = base
    chartOption.xAxis.max = base + X_AXIS_RANGE

    chart.setOption(chartOption)
  }
}

function addSamplesToDisplay (amount = 1) {
  let indexBase = lastSampleAdded

  if (indexBase >= SAMPLES.length) {
    return
  }

  lastSampleAdded = indexBase + amount

  let samplesToAdd = SAMPLES
    .slice(indexBase, indexBase + amount)
    .map((value, index) => [
      Math.floor((index + indexBase) / SAMPLE_RATE * 1000),
      value
    ])

  for (let index = 0; index < filters.length; index++) {
    let filter = filters[index]
    let raw = samplesDisplay.slice()

    for (let sample of samplesToAdd) {
      raw.push(sample)
      filter.handler(sample, raw, filter.data)
    }

    if (filter.data.length > DISPLAY_SAMPLES_MAX) {
      // filter.data.splice(0, filter.data.length - DISPLAY_SAMPLES_MAX)
    }
  }

  samplesDisplay = samplesDisplay.concat(samplesToAdd)

  if (samplesDisplay.length > DISPLAY_SAMPLES_MAX) {
    // samplesDisplay = samplesDisplay.slice(
      // samplesDisplay.length - DISPLAY_SAMPLES_MAX
    // )
  }

  updateDisplay()
}

// let interval = setInterval(() => {
  // if (isPlaying) {
    // addSamplesToDisplay(DISPLAY_FEED_SIZE)
  // }
// }, 1000 / SAMPLE_RATE * DISPLAY_FEED_SIZE * DISPLAY_UPDATE_TIME_FACTOR)

let fps = 60
let lastUpdate = new Date()
let samplesFed = 0
let samplesProcessed = 0
let interval = setInterval(() => {
  if (isPlaying) {
    let now = new Date()
    let tick = (now - lastUpdate) * DISPLAY_UPDATE_TIME_FACTOR
    lastUpdate = now

    let samplesAdvance = SAMPLE_RATE * tick / 1000
    samplesProcessed += samplesAdvance

    let newSamples = Math.floor(samplesProcessed) - samplesFed

    if (newSamples > 0) {
      samplesFed += newSamples
      addSamplesToDisplay(newSamples)
    }
  }
}, 1000 / fps)

function toggleSimulationPlaying () {
  isPlaying = !isPlaying

  let sampling = isPlaying
    ? 'average'
    : undefined

  for (let s of chartOption.series) {
    s.sampling = sampling
  }

  chart.setOption(chartOption)

  btnPlayPause.textContent = isPlaying
    ? '  Pausar '
    : 'Continuar'
}

function restartSimulation () {
  lastSampleAdded = 0
  samplesFed = 0
  samplesProcessed = 0
  lastUpdate = new Date()
  samplesDisplay = []
  for (let filter of filters) {
    filter.data.splice(0, filter.data.length)
  }
  addSamplesToDisplay()
}