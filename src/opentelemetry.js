'use strict'

const { MeterProvider } = require('@opentelemetry/sdk-metrics-base')
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus')

async function startMetricsEndpoint() {
  const exporter = new PrometheusExporter(
    {
      startServer: true
    },
    () => {
      console.log(
        `prometheus scrape endpoint: http://localhost:${PrometheusExporter.DEFAULT_OPTIONS.port}${PrometheusExporter.DEFAULT_OPTIONS.endpoint}`
      )
    }
  )

  const meter = new MeterProvider({ // Esse Meter precisa ir para service.js
    exporter,
    interval: 1000
  }).getMeter('example-prometheus')

  const requestCounter = meter.createCounter('requests', {
    description: 'Example of a Counter'
  })

  const upDownCounter = meter.createUpDownCounter('test_up_down_counter', {
    description: 'Example of a UpDownCounter'
  })

  const labels = { pid: process.pid, environment: 'staging' }

  setInterval(() => {
    requestCounter.add(1, labels)
    upDownCounter.add(Math.random() > 0.5 ? 1 : -1, labels)
  }, 1000)

  return meter

}

module.exports = { startMetricsEndpoint }
