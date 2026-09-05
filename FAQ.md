# Hints and FAQ

## Do I need solar panels or a battery to use this?

Only a grid meter with an imported-energy counter is strictly required to set up the app, but without at least solar or a battery configured there's nothing to split - every device would simply show 100% grid. Solar and battery are optional; their capabilities only appear on a device once you've added at least one such source in Settings.

## My grid meter doesn't report exported energy - is that a problem?

Leave that field empty in Settings and it's treated as zero. Grid import alone is enough to correctly track grid-sourced consumption. The only downside is during periods where your solar or battery actually export surplus to the grid: without an export reading, that surplus gets counted as if the house used it, slightly inflating solar/battery's apparent share at those times. If you rarely or never export (no solar, or a small self-consuming system), this makes no practical difference.

## Why do I have to manually pick a capability instead of the app finding it automatically?

Capability ids for import, export, production, charge and discharge energy aren't standardized across drivers - for example, some P1 meter apps use different ids for the same thing. You map each role once, to whichever capability your specific device exposes.

## What's the difference between "Device Energy Allocation" and "Whole House Energy Allocation"?

Device Energy Allocation follows one or more specific counters and works out where *that* energy came from. Whole House Energy Allocation is a single device reflecting the entire home's split, regardless of which individual devices you're tracking.

## What's "Individual" vs. "Summary" mode?

Individual creates one allocator per counter you select - a separate tile per appliance. Summary creates a single device that adds several counters together first, for one combined tile.

## Can I add the same device or counter more than once?

Yes, on purpose - for example to feed two differently-named allocators, or to include one counter in more than one summary device.

## I picked the wrong device/counter - do I have to delete and re-pair?

No - open the device's settings and choose **Repair**. You can reselect the source(s); running totals aren't reset, they simply continue from the new source. Repair can't change individual/summary mode, only the source(s).

## Why don't these numbers show up in Homey's Energy tab?

On purpose - see "What you'll get" in the overview post. They're estimates derived from meters Homey already counts, so including them too would double count.

## A device shows 0 right after I add it, or after changing Settings

The app samples every 5 minutes. The very first sample after startup, pairing, or a settings change only establishes a starting point - real numbers appear from the sample after that.

## My meter reports in coarse steps (e.g. 0.1 kWh) and I see gaps

At very low power, a coarse meter may not tick within one 5-minute sample, so that interval is skipped rather than guessed. Nothing is lost from the meters themselves - the next interval catches up as soon as a real change is seen.

## What do "Grid allocation" and "Self-sufficiency" mean?

Grid allocation is the percentage of a device's recent consumption (smoothed over ~25 minutes) that came from the grid. Self-sufficiency is the rest - the percentage that came from solar and/or the battery.

## How do I get notified when the split changes?

Use the **"Energy allocation changed"** Flow trigger - set how many percentage points it must move before firing in Settings. For a plain threshold check ("is grid allocation above 50%?"), use Homey's own **Logic** card with the "Grid allocation" or "Self-sufficiency" number token; no separate condition card is needed for that.
