# Narrative

## Introduction (brief)
* what is BVH
* why we use it in ray tracing
* why tight fit matters (SAH-driven construction)
- no technical details, just high-level stuff, nice visualizations and animations

## SOBB
* what it is
* we introduced it in EG25
* approximate fitting algo, faster and simpler than approximate OBBs

## SOBB (or tight) BVH construction
* explain BV transformation
* menton others doing it

## Wide Compressed SOBB
* why it matters
* why shared basis matters for quantization
* how to find shared basis for a wide node, (sum, union, our avg proxy) - minimum text, clean visualizations

## Impact - static scene traversal
* simplified, aggregate charts from the paper data, nothing overwhelming
* focus on strong results, positives

## AABB BVH Refit
* why it's useful
* why it's difficult for tight BVHs
* visualise traditional BVH refit, with focus on data propagation - leaves refit on triangles, only AABBs propagate up - enough to find parent
* illustrate also the typical atomic-driven sync in GPU parallel implementation - hihlight the wait for all (8) children to find parent's BV

## SOBB BVH refit
* on similar-to-prevous visualization, explaint the problem - bounds propagation insufficient, orientations are mis-aligned between BVH levels
* explain previous approach of k-DOP propagation and full BV refit, it's problems with efficiency

## Per geometry refit
* visualize triangle propagation, refit
* explain how it avoids hard sync as well as atomic congestion (local vs. global tests, miniscule root updates)
* show comparison to previous numbers (immense savings)
* perhaps play a video snippet?

## Conclusion
* summarize what we learned, highlight results
* honorable mentions to technical details crucial to make this work
* mention more minor contributions, no in-depth explanations, redirect to paper/implementation (traversal order, greedy-swaps, slab selection, etc.)
* implementation QR

## Questions?
* looping video
