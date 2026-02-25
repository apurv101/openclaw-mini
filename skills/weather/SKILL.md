---
name: weather
description: Fetch current weather and forecasts for any location
---

When asked about weather:

1. Use `web_search` with query: `current weather in <location>`
2. Extract from results:
   - Temperature (both Fahrenheit and Celsius)
   - Conditions (sunny, cloudy, rain, etc.)
   - Humidity and wind if available
   - Forecast summary if available
3. Present cleanly:
   ```
   Weather for <Location>:
   - Temperature: XXF / XXC
   - Conditions: description
   - Humidity: XX%
   - Wind: XX mph
   ```

If the location is ambiguous, ask for clarification. If web_search returns no useful results, let the user know.
