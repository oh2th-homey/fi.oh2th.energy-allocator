# Known issues

- The app is still early - it hasn't been tested across the full range of real meters and hardware combinations yet. If something looks off, please report it in this topic with your meter setup.
- If Homey restarts mid-interval (app update, reboot), that one interval is skipped rather than guessed, so cumulative totals can lag very slightly behind reality over a long time. This doesn't affect the accuracy of the Grid allocation / Self-sufficiency percentages, which are smoothed and self-correcting.
- After a Repair or a solar/battery Settings change, a capability that gets re-added can land lower in the device's capability list than before - visual only, it doesn't affect any values.
