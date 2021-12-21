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

  const meter = new MeterProvider({
    exporter,
    interval: 1000
  }).getMeter('example-prometheus')

  return meter
}

module.exports = { startMetricsEndpoint }
