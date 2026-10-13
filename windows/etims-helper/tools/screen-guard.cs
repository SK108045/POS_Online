using System;
using System.Drawing;
using System.Collections.Generic;
using System.IO;

public static class OraforgeScreenGuard {
 sealed class Reference { public Bitmap Image; public DateTime Written; public long Length; }
 static readonly Dictionary<string, Reference> references = new Dictionary<string, Reference>();
 static Bitmap ReferenceImage(string path) {
  FileInfo file = new FileInfo(path);
  Reference reference;
  if (references.TryGetValue(file.FullName, out reference) && reference.Written == file.LastWriteTimeUtc && reference.Length == file.Length)
   return reference.Image;
  Bitmap image;
  using (Bitmap original = new Bitmap(file.FullName)) image = new Bitmap(original);
  if (reference != null) reference.Image.Dispose();
  references[file.FullName] = new Reference { Image=image, Written=file.LastWriteTimeUtc, Length=file.Length };
  return image;
 }
 public static bool MatchesFile(Bitmap actual, string path, int x, int y, int width, int height) {
  return Matches(actual, ReferenceImage(path), x, y, width, height);
 }
 public static void VerifyFile(Bitmap actual, string path, int x, int y, int width, int height) {
  if (!MatchesFile(actual, path, x, y, width, height))
   throw new InvalidOperationException("Screen does not match the verified workflow; no action sent");
 }
 // Preserve the original sampling, per-channel tolerance, and mismatch limit.
 public static void Verify(Bitmap actual, Bitmap reference, int x, int y, int width, int height) {
  if (!Matches(actual, reference, x, y, width, height))
   throw new InvalidOperationException("Screen does not match the verified workflow; no action sent");
 }
 public static bool Matches(Bitmap actual, Bitmap reference, int x, int y, int width, int height) {
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
  return count != 0 && different / (double)count <= 0.004;
 }
}
