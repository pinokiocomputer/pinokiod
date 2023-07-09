class Mingw {
  constructor(bin) {
    this.bin = bin
    if (bin.platform === "win32") {
      if (bin.arch === "x64") {
        this.url = "https://github.com/brechtsanders/winlibs_mingw/releases/download/13.1.0-16.0.5-11.0.0-msvcrt-r5/winlibs-x86_64-posix-seh-gcc-13.1.0-llvm-16.0.5-mingw-w64msvcrt-11.0.0-r5.zip"
      }
    }
  }
}
