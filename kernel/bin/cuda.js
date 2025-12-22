const semver = require('semver')
const fs = require('fs')
const path = require('path')
const { glob } = require('glob')
class Cuda {
  async hasNvTargetHeader() {
    const prefix = this.kernel.bin.path("miniconda")
    const patterns = [
      "Library/include/nv/target",
      "include/nv/target",
      "Library/targets/*/include/nv/target",
      "targets/*/include/nv/target",
    ]
    for (const pattern of patterns) {
      if (pattern.includes("*")) {
        try {
          const matches = await glob(pattern, { cwd: prefix, absolute: true, nodir: true })
          if (matches && matches.length > 0) {
            return true
          }
        } catch (e) {}
      } else {
        try {
          await fs.promises.stat(path.resolve(prefix, pattern))
          return true
        } catch (e) {}
      }
    }
    return false
  }
  async patchCudaActivationScript() {
    if (this.kernel.platform !== "win32") {
      return
    }
    const script = this.kernel.bin.path("miniconda/etc/conda/activate.d/pinokio/~cuda-nvcc_activate.bat")
    let content
    try {
      content = await fs.promises.readFile(script, "utf8")
    } catch (e) {
      return
    }
    const lines = content.split(/\r?\n/)
    const filtered = []
    let skipBlock = false
    for (const line of lines) {
      if (!skipBlock) {
        if (/^\s*if\s+not\s+defined\s+(CUDAARCHS|TORCH_CUDA_ARCH_LIST)\s*\(\s*$/i.test(line)) {
          skipBlock = true
          continue
        }
        if (/set\s+\"?(TORCH_CUDA_ARCH_LIST|CUDAARCHS)=/i.test(line)) {
          continue
        }
        filtered.push(line)
      } else {
        if (/^\s*\)\s*$/.test(line)) {
          skipBlock = false
        }
      }
    }
    if (filtered.length !== lines.length) {
      const eol = content.includes("\r\n") ? "\r\n" : "\n"
      await fs.promises.writeFile(script, filtered.join(eol))
    }
  }
  async stashActivationScripts() {
    if (this.kernel.platform !== "win32") {
      return
    }
    const folder = this.kernel.bin.path("miniconda/etc/conda/activate.d")
    const stash = path.resolve(folder, "pinokio")
    await fs.promises.mkdir(stash, { recursive: true }).catch(() => {})
    const scripts = [
      "~cuda-nvcc_activate.bat",
      "vs2019_compiler_vars.bat",
      "vs2022_compiler_vars.bat",
    ]
    for (const script of scripts) {
      const dest = path.resolve(stash, script)
      for (const src of [path.resolve(folder, script), path.resolve(folder, `${script}.disabled`)]) {
        try {
          await fs.promises.rename(src, dest)
          break
        } catch (e) {
          if (e && e.code === "EEXIST") {
            await fs.promises.rm(src).catch(() => {})
            break
          }
        }
      }
    }
    await this.patchCudaActivationScript()
  }
  async install(req, ondata) {
    if (this.kernel.gpu === "nvidia") {
      if (this.kernel.platform === "win32") {
        await this.kernel.bin.exec({
          message: [
            "conda clean -y --all",
            "conda install -y cudnn libzlib-wapi -c conda-forge",
          ]
        }, ondata)
        await this.kernel.bin.exec({
          message: [
            "conda clean -y --all",
            "conda install -y nvidia/label/cuda-12.8.1::cuda conda-forge::cuda-cccl"
          ]
        }, ondata)
        await this.stashActivationScripts()
      } else {
        await this.kernel.bin.exec({
          message: [
            "conda clean -y --all",
            "conda install -y cudnn -c conda-forge",
          ]
        }, ondata)
        await this.kernel.bin.exec({
          message: [
            "conda clean -y --all",
            "conda install -y nvidia/label/cuda-12.8.1::cuda"
          ]
        }, ondata)
        if (this.kernel.platform === "linux") {
          await this.kernel.bin.exec({
            message: [
              "conda install -y -c conda-forge nccl"
            ]
          }, ondata)
        }
      }
    }
  }
  async installed() {
    if (this.kernel.gpu === "nvidia") {
      if (this.kernel.platform === 'win32') {
        await this.stashActivationScripts()
        if (this.kernel.bin.installed.conda.has("cudnn") && this.kernel.bin.installed.conda.has("cuda") && this.kernel.bin.installed.conda.has("libzlib-wapi")) {
          let version = this.kernel.bin.installed.conda_versions.cuda
          if (version) {
            let coerced = semver.coerce(version)
            console.log("cuda version", coerced)
            if (semver.satisfies(coerced, ">=12.8.1")) {
              console.log("cuda satisfied")
              if (!(await this.hasNvTargetHeader())) {
                return false
              }
              let deactivate_list = [
                "vs2019_compiler_vars.bat",
                "vs2022_compiler_vars.bat",
              ]
              const folder = this.kernel.bin.path("miniconda/etc/conda/activate.d")
              let at_least_one_exists = false
              for(let item of deactivate_list) {
                let exists = await this.kernel.exists("bin/miniconda/etc/conda/activate.d/" + item)
                if (exists) {
                  // break if at least one exists
                  at_least_one_exists = true
                  break
                }
              }
              console.log("vs_compiler_vars exists?", at_least_one_exists)
              if (at_least_one_exists) {
                return false
              } else {
                return true
              }
            }
          }
        }
      } else {
        if (this.kernel.bin.installed.conda.has("cudnn") && this.kernel.bin.installed.conda.has("cuda")) {
          let version = this.kernel.bin.installed.conda_versions.cuda
          if (version) {
            let coerced = semver.coerce(version)
            console.log("cuda version", coerced)
            if (semver.satisfies(coerced, ">=12.8.1")) {
              console.log("satisfied")
              return true
            }
          }
        }
      }
      return false
    } else {
      // just return true for all other gpus so they can be avoided
      return true
    }
  }
  env() {
    if (this.kernel.platform === 'win32') {
      return {
        CUDA_HOME: this.kernel.bin.path("miniconda/Library")
      }
    } else {
      return {
        CUDA_HOME: this.kernel.bin.path("miniconda")
      }
    }
  }
//  env() {
//    return {
//      GIT_CONFIG_GLOBAL: gitconfig_path
//export CUDA_HOME=/usr/local/cuda
//export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/local/cuda/lib64:/usr/local/cuda/extras/CUPTI/lib64
//export PATH=$PATH:$CUDA_HOME/bin
//
//    }
//  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove cudnn cuda",
    }, ondata)
  }
}
module.exports = Cuda
