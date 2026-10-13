using System;
using System.Drawing;

public static class OraforgeScreenGuard {
 // Preserve the original sampling, per-channel tolerance, and mismatch limit.
 public static void Verify(Bitmap actual, Bitmap reference, int x, int y, int width, int height) {
  if (actual.Width != 1384 || actual.Height != 786)
   throw new InvalidOperationException("Unverified window geometry");
  if (reference.Width != width || reference.Height != height || width <= 0 || height <= 0 ||
      x < 0 || y < 0 || x + width > actual.Width || y + height > actual.Height)
   throw new InvalidOperationException("Invalid reference dimensions");
  int count = 0, different = 0;
  for (int yy = y; yy < y + height; yy += 2)
   for (int xx = x; xx < x + width; xx += 2) {
    Color a = actual.GetPixel(xx, yy), b = reference.GetPixel(xx - x, yy - y);
    count++;
    if (Math.Abs(a.R - b.R) > 24 || Math.Abs(a.G - b.G) > 24 || Math.Abs(a.B - b.B) > 24)
     different++;
   }
  if (count == 0 || different / (double)count > 0.004)
   throw new InvalidOperationException("Screen does not match the verified workflow; no action sent");
 }
}
