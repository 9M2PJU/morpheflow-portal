import json
import os
import re
import shutil
import requests
import hashlib
import subprocess
import urllib.parse
from pathlib import Path
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class Morphe:

    def __init__(self, project_root: Path, original_dir: Path, patched_dir: Path, architecture: str, detailed_app_list: dict[str, dict], repo_details: dict[str, dict], low_spec_mode: bool, force: bool) -> None:
        self.project_root = project_root
        self.repo_details = repo_details
        self.arch = architecture
        self.low_spec_mode = low_spec_mode
        self.detailed_patch_list = detailed_app_list
        self.force = force
        
        self.options_dir = project_root / "tools" / "automorph-data" / "options"
        self.original_dir = original_dir
        self.patched_dir = patched_dir
        self.state_dir = project_root / "tools" / "automorph-data" / "state" 
        self.morphe_location = project_root / "tools" / "morphe.jar"
        
        self.repo_versions_json = self.state_dir / "repo_versions.json"
        self.options_checksum_json = self.state_dir / "options_checksum.json"

        self.keystore_alias = os.getenv("AUTOMORPH_KEYSTORE_ALIAS", "automorph")
        self.keystore_password = os.getenv("AUTOMORPH_KEYSTORE_PASSWORD", "automorph")
        self.keystore_entry_password = os.getenv("AUTOMORPH_KEYSTORE_ENTRY_PASSWORD", "automorph")
        self.keystore_path = self._resolve_keystore()

        self.java_bin = "java"
        if shutil.which("/opt/homebrew/opt/openjdk/bin/java"):
            self.java_bin = "/opt/homebrew/opt/openjdk/bin/java"
        elif os.environ.get("JAVA_HOME"):
            candidate = Path(os.environ["JAVA_HOME"]) / "bin" / "java"
            if candidate.is_file():
                self.java_bin = str(candidate)

        self.repo_search: dict[str, set[str]] = {}
        self.enabled_patches_per_app: dict[str, dict[str, dict[str, str]]]

    def _resolve_keystore(self) -> Path:
        """
        Resolves or generates a persistent keystore so that patched APK signatures
        remain 100% deterministic and permanent across builds and updates.
        """
        import base64

        # 1. Explicit path from env
        env_path = os.getenv("AUTOMORPH_KEYSTORE_PATH")
        if env_path:
            p = Path(env_path)
            if p.is_file():
                logger.info(f"[*] Using keystore from AUTOMORPH_KEYSTORE_PATH: {p}")
                return p

        # 2. Base64 encoded secret from env (useful for CI secrets)
        b64_keystore = os.getenv("AUTOMORPH_KEYSTORE_BASE64")
        target_path = self.project_root / "tools" / "automorph-data" / "automorph.keystore"
        if b64_keystore and not target_path.is_file():
            try:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with open(target_path, "wb") as f:
                    f.write(base64.b64decode(b64_keystore))
                logger.info(f"[✓] Restored persistent keystore from AUTOMORPH_KEYSTORE_BASE64: {target_path}")
                return target_path
            except Exception as e:
                logger.error(f"[!] Failed to decode AUTOMORPH_KEYSTORE_BASE64: {e}")

        # 3. Dedicated persistent repository keystore
        if target_path.is_file():
            logger.info(f"[*] Using persistent AutoMorph keystore: {target_path}")
            return target_path

        # 4. Custom keystores placed in morphe-data
        for custom_name in ("morphe.keystore", "Morphe.keystore"):
            custom_p = self.project_root / "tools" / "morphe-data" / custom_name
            if custom_p.is_file():
                logger.info(f"[*] Using custom user keystore: {custom_p}")
                return custom_p

        # 5. If none exists, auto-generate automorph.keystore
        target_path.parent.mkdir(parents=True, exist_ok=True)
        logger.info(f"[*] Generating new permanent AutoMorph keystore at {target_path}...")
        try:
            gen_cmd = [
                "keytool",
                "-genkeypair",
                "-alias", self.keystore_alias,
                "-keyalg", "RSA",
                "-keysize", "2048",
                "-validity", "10000",
                "-keystore", str(target_path),
                "-storepass", self.keystore_password,
                "-keypass", self.keystore_entry_password,
                "-dname", "CN=AutoMorph, OU=AutoMorph, O=AutoMorph, L=Internet, ST=Global, C=XX"
            ]
            subprocess.run(gen_cmd, check=True, capture_output=True, text=True)
            logger.info(f"[✓] Successfully generated persistent keystore: {target_path}")
        except Exception as e:
            logger.warning(f"[!] Could not run keytool to pre-generate keystore ({e}). Morphe CLI will create it on patch execution.")

        return target_path

    def get_cached_repo(self, repo: str) -> Path | None:
        owner = self.repo_details[repo]['owner']
        repo_name = self.repo_details[repo]['repo_name']
        cached_repo_dir = self.project_root / "tools" / "morphe-data" / "patches" / f"{owner}-{repo_name}"

        if not cached_repo_dir.is_dir() or not any(cached_repo_dir.iterdir()):
            logger.info(f"\n[*] Cached repo missing for '{owner}/{repo_name}'. Downloading patch bundle...")
            self.build_repo_cache({repo: self.check_repo(repo)})

        if not cached_repo_dir.is_dir():
            logger.error(f"\n[!] Skipping options for '{owner}/{repo_name}': cache directory does not exist.")
            return None

        cached_repo = next(cached_repo_dir.iterdir(), None)
        if cached_repo and "instaprime" in repo_name.lower():
            self.adapt_instaprime_mpp(cached_repo)
        
        return cached_repo

    def adapt_instaprime_mpp(self, mpp_path: Path) -> None:
        if not mpp_path or not mpp_path.is_file():
            return
        import zipfile
        try:
            tmp_mpp = mpp_path.with_suffix(".adapting.tmp")
            adapted = False
            with zipfile.ZipFile(mpp_path, "r") as zin, zipfile.ZipFile(tmp_mpp, "w") as zout:
                for item in zin.infolist():
                    content = zin.read(item.filename)
                    if item.filename == "app/instaprime/patches/instaprime/UnlockPremiumPatchKt.class":
                        idx = content.find(b"\x11\x10\x00")
                        if idx != -1:
                            content = content[:idx] + b"\x11\x40\x00" + content[idx + 3:]
                            adapted = True
                            logger.info(f" └── [✓] Adapted InstaPrime patch bundle for V8.0+ support (MAX_GATE_DISTANCE expanded to 16KB).")
                    zout.writestr(item, content)
            if adapted:
                tmp_mpp.replace(mpp_path)
            else:
                tmp_mpp.unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f" └── [!] Note during InstaPrime MPP adaptation: {e}")

    def harden_instaprime_binary(self, apk_path: Path) -> None:
        if not apk_path or not apk_path.is_file():
            return
        import zipfile, struct
        try:
            tmp_apk = apk_path.with_suffix(".hardened.tmp")
            needs_hardening = False
            with zipfile.ZipFile(apk_path, "r") as zin:
                for name in zin.namelist():
                    if "libprimemods.so" in name:
                        so_data = zin.read(name)
                        for off in [0xbb31a0, 0xbb7a28]:
                            if off + 4 <= len(so_data):
                                w = struct.unpack_from("<I", so_data, off)[0]
                                if w == 0x52800020:
                                    needs_hardening = True
                                    break
            if not needs_hardening:
                return

            with zipfile.ZipFile(apk_path, "r") as zin, zipfile.ZipFile(tmp_apk, "w") as zout:
                for item in zin.infolist():
                    content = zin.read(item.filename)
                    if "libprimemods.so" in item.filename:
                        b = bytearray(content)
                        for off in [0xbb31a0, 0xbb7a28]:
                            if off + 4 <= len(b):
                                w = struct.unpack_from("<I", b, off)[0]
                                if w == 0x52800020:
                                    struct.pack_into("<I", b, off, 0x52800000)
                                    logger.info(f" └── [✓] Pre-patched InstaPrime subscription check at {hex(off)} (0x52800020 -> 0x52800000).")
                        content = bytes(b)
                    zout.writestr(item, content)
            tmp_apk.replace(apk_path)
            logger.info(" └── [✓] InstaPrime native library prepared and verified for Morphe compiler.")
        except Exception as e:
            logger.warning(f" └── [!] Warning during InstaPrime binary preparation: {e}")

#################################
#             MAIN              #
#################################

    def package_req_main(self) -> tuple[dict[str, list[str]], dict] | None:
        self.repo_search = self.scan_updates()

        if self.force:
            (package_name, details), = self.detailed_patch_list.items()
            self.repo_search = dict.fromkeys(details["repos"], {package_name})
        
        if not self.repo_search:
            logger.info("\n[✓] No updated option files or new/updated repos found.\n Exiting...")
            return None
        
        enabled_patches_per_app, all_enabled_repos = self.options_main()
        package_version_req, enabled_patches_per_app_versions = self.get_patch_versions_main(enabled_patches_per_app, all_enabled_repos)
        return package_version_req, enabled_patches_per_app_versions

#################################
#    FIND NEW/UPDATED REPOS     #
#################################

    def scan_updates(self) -> dict[str, set[str]]:
        new_repo_versions = self.find_repo_version()
        updated_repos = self.check_repo_update(new_repo_versions)

        if updated_repos:
            self.build_repo_cache(updated_repos)  
            self.write_repo_versions_json(new_repo_versions)

        if all(repo in updated_repos for repo in self.repo_details):
            return updated_repos
        
        return self.check_options_change(updated_repos)

    def find_repo_version(self) -> dict[str, list[str]] | None:
        repo_version = {}

        for repo in self.repo_details:
            owner = self.repo_details[repo]['owner']
            repo_name = self.repo_details[repo]['repo_name']
            repo_type = self.repo_details[repo]['repo_type']

            if not owner or not repo_name:
                logger.error(f"Unable to find owner or repo of {repo}")
                return None

            if repo_type == 'github' or repo_type == 'gitlab':
                headers = {
                    "User-Agent": "MorpheUpdater",
                    "Accept": "application/json",
                }

            if repo_type == 'github':
                api_url = f"https://api.github.com/repos/{owner}/{repo_name}/releases/latest"      

                token = os.getenv("GITHUB_TOKEN")
                if token:
                    headers["Authorization"] = f"Bearer {token}"

            elif repo_type == 'gitlab':
                project_path = urllib.parse.quote(f"{owner}/{repo_name}", safe="")
                api_url = f"https://gitlab.com/api/v4/projects/{project_path}/releases/permalink/latest"
            
            else:
                logger.warning(f" └── [✗] Unknown repo type: {repo_type} for {repo}")
                continue

            self.repo_details[repo].update({'api_url': api_url, 'headers': headers}) 

            try:
                response = requests.get(api_url, headers=headers, timeout=10)
                if response.status_code == 404 and repo_type == 'github':
                    # Fallback for repositories where the release is tagged as a prerelease (e.g. drappula/morphe-patches-instaprime)
                    releases_url = f"https://api.github.com/repos/{owner}/{repo_name}/releases"
                    rel_resp = requests.get(releases_url, headers=headers, timeout=10)
                    if rel_resp.status_code == 200 and len(rel_resp.json()) > 0:
                        first_rel = rel_resp.json()[0]
                        tag = first_rel.get("tag_name")
                        if tag:
                            self.repo_details[repo]['tag_name'] = tag
                        repo_version[repo] = re.findall(r"\d+", tag) if tag else []
                        self.repo_details[repo]['release_payload'] = first_rel
                        continue

                if response.status_code == 200:
                    tag = response.json().get("tag_name")
                    if tag:
                        self.repo_details[repo]['tag_name'] = tag
                    repo_version[repo] = re.findall(r"\d+", tag) if tag else []

                elif response.status_code == 404:
                    logger.warning(" └── [!] 404 error")
                response.raise_for_status()

            except requests.exceptions.RequestException as e:
                logger.error(f" └── [!] Failed checking release for {owner}/{repo_name}: {e}")

        return repo_version

    def check_repo_update(self, new_repo_versions: dict[str, list[str]]) -> dict[str, set[str]]:
        repo_search = {} 

        if self.repo_versions_json.is_file():
            logger.info("[*] Checking for repo updates...")
            with open(self.repo_versions_json, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                for repo in self.repo_details:
                    owner = self.repo_details[repo]['owner']
                    if repo not in cached_data:
                        logger.info(f" └── [!] {owner} repo is new. Will add to updated repos list")
                        repo_search[repo] = self.check_repo(repo)    
                    elif repo not in new_repo_versions:
                        logger.warning(f" └── [✗] {owner} repo missing from parsed versions. Skipping.")
                    else:
                        owner = self.repo_details[repo]['owner']
                        repo_name = self.repo_details[repo]['repo_name']
                        cached_repo_dir = self.project_root / "tools" / "morphe-data" / "patches" / f"{owner}-{repo_name}"
                        has_cached_mpp = cached_repo_dir.is_dir() and any(cached_repo_dir.iterdir())

                        cached_version = tuple(int(n) for n in cached_data[repo])
                        new_version = tuple(int(n) for n in new_repo_versions[repo])

                        if new_version > cached_version or not has_cached_mpp:
                            if not has_cached_mpp:
                                logger.info(f" └── [!] Cached bundle missing on disk for {owner}. Will add to updated repos list.")
                            else:
                                logger.info(f" └── [!] New repo version for {owner} repo. Will add to updated repos list.")
                            repo_search[repo] = self.check_repo(repo)
                        else:
                            logger.info(f" └── [✓] Latest version of {owner} already used.") 
      
        else:
            logger.info(f"[*] No repo_versions.json found. Adding all repos to updated repos list...")
            for repo in self.repo_details:
                repo_search[repo] = self.check_repo(repo)

        return repo_search

    def build_repo_cache(self, updated_repos: dict[str, set[str]]) -> None:
        for repo in updated_repos:
            owner = self.repo_details[repo]['owner']
            repo_name = self.repo_details[repo]['repo_name']
            repo_type = self.repo_details[repo]['repo_type']
            api_url = self.repo_details[repo]['api_url']
            headers = self.repo_details[repo]['headers']

            try:
                if 'release_payload' in self.repo_details[repo]:
                    response = self.repo_details[repo]['release_payload']
                else:
                    res = requests.get(api_url, headers=headers, timeout=15)
                    if res.status_code == 404 and repo_type == 'github':
                        releases_url = f"https://api.github.com/repos/{owner}/{repo_name}/releases"
                        rel_res = requests.get(releases_url, headers=headers, timeout=15)
                        if rel_res.status_code == 200 and len(rel_res.json()) > 0:
                            response = rel_res.json()[0]
                        else:
                            res.raise_for_status()
                    else:
                        res.raise_for_status()
                        response = res.json()
            except requests.exceptions.RequestException as e:
                status = getattr(getattr(e, "response", None), "status_code", None)
                if status == 404:
                    logger.error(f" └── [!] Repo or release not found (404) for '{owner}/{repo_name}'. Skipping...")
                else:
                    logger.error(f" └── [!] Failed checking release for '{owner}/{repo_name}': {e}")
                continue

            if repo_type == 'github':
                asset_list = response.get("assets", [])
            elif repo_type == 'gitlab':
                asset_list = response.get("assets", {}).get("links", [])

            mpp_asset = next((a for a in asset_list if a.get("name", "").endswith(".mpp")), None)

            if mpp_asset:
                if repo_type == 'github':
                    download_url = mpp_asset["browser_download_url"]
                elif repo_type == 'gitlab':
                    download_url = mpp_asset["direct_asset_url"]
                file_name = mpp_asset["name"]
            else:
                logger.error("No .mpp asset found in release.")
                continue    

            tag_name = response.get('tag_name', "")
            if tag_name:
                self.repo_details[repo]['tag_name'] = tag_name
            dest = self.project_root / "tools" / "morphe-data" / "patches" / f"{owner}-{repo_name}" / f"{tag_name}__{file_name}"
            dest.parent.mkdir(parents=True, exist_ok=True)

            for item in dest.parent.iterdir():
                if item.is_file():
                    item.unlink(missing_ok=True)

            dl_headers = {"User-Agent": "MorpheDownloader"}
            try:
                with requests.get(download_url, headers=dl_headers, stream=True, timeout=60) as r:
                    r.raise_for_status()
                    tmp_path = dest.with_suffix(".tmp")
                    with open(tmp_path, "wb") as f:
                        for chunk in r.iter_content(chunk_size=128 * 1024):
                            if chunk:
                                f.write(chunk)
                    tmp_path.replace(dest)
                    if "instaprime" in repo_name.lower():
                        self.adapt_instaprime_mpp(dest)
                    logger.info(f" └── [✓] Download complete for '{owner}': {dest.name}")
                    self.repo_details[repo]['cached_repo'] = {'cached_mpp_path': dest}
            except requests.exceptions.RequestException as e:
                logger.error(f" └── [!] Download failed for '{file_name}': {e}")
                if "tmp_path" in locals() and tmp_path.exists():
                    tmp_path.unlink(missing_ok=True)
                continue

    def check_options_change(self, updated_repos: dict[str, set[str]]) -> dict[str, set[str]]:
        logger.info(f"\n[*] Checking for updates to options files...")

        repo_options_list = []
        for app, details in self.detailed_patch_list.items():
            app_options_dir = self.options_dir / app
            expected_repos = details.get('repos', [])

            for repo in expected_repos:
                if repo in self.repo_details:
                    expected_options = app_options_dir / f"{self.repo_details[repo]['owner']}_options.json"
                    if not expected_options.is_file():
                        updated_repos.setdefault(repo, set()).add(app)
            
            repo_options_list.extend(app_options_dir.glob('*.json'))

        checksums = self.generate_checksum(repo_options_list)

        try: 
            with open(self.options_checksum_json) as f:
                cached_checksums = json.load(f)

        except FileNotFoundError:
            logger.info(f" └── [!] No checksum json found. Will add all repos to update repos list...")
            for repo in self.repo_details:
                updated_repos[repo] = self.check_repo(repo)
            return updated_repos

        for options_json, checksum in checksums.items():
            cached_checksum = cached_checksums.get(options_json)
            if cached_checksum is None:
                for k, v in cached_checksums.items():
                    if k.endswith(options_json):
                        cached_checksum = v
                        break

            if cached_checksum is not None:
                if not checksum == cached_checksum:
                    options_file = options_json.split("/")[-1]
                    package_name = options_json.split("/")[-2]
                    options_owner = options_json.split("/")[-1].split("_options.json")[0]
                    owner_to_repo = {d['owner']: r for r, d in self.repo_details.items()}

                    logger.info(f" └── [!] Options file '{package_name}/{options_file}' has changed. Will add to update repos list.")
          
                    if options_owner not in owner_to_repo:
                        logger.warning(f" └── [!] Could not locate repo for '{options_owner}'. Skipping...")
                        continue
                    matched_repo = owner_to_repo[options_owner]
                    updated_repos.setdefault(matched_repo, set()).add(package_name)
        return updated_repos
                    
    def write_repo_versions_json(self, new_repo_versions: dict[str, list[str]]) -> None:
        logger.info("\n[*] Updating/creating repo version cache...")

        try:
            with open(self.repo_versions_json, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            logger.info(" └── [!] Updating repo version cache...")
            self.repo_versions_json.parent.mkdir(parents=True, exist_ok=True)
            data = {}

        data.update(new_repo_versions)

        try:
            with open(self.repo_versions_json, "w", encoding="utf-8") as fi:
                fi.write("{\n")
                entries = [f'  {json.dumps(repo)}: {json.dumps(version)}' for repo, version in data.items()]
                fi.write(",\n".join(entries))
                fi.write("\n}\n") 
            logger.info(f" └── [✓] '{self.repo_versions_json}' successfully updated.")

        except OSError as e:
            logger.error(f" └── [!] Failed to write {self.repo_versions_json.name}: {e}")

    def check_repo(self, repo: str | None = None) -> set[str]:
        app_set = set()

        helper = {package_name: details['repos'] for package_name, details in self.detailed_patch_list.items()}

        for package, repos in helper.items():
            if repo in repos:
                app_set.add(package)

        return app_set

    def get_cached_repo_path(self, owner: str, repo_name: str, repo: str) -> Path | None:
        mpp_path = self.repo_details.get(repo, {}).get("cached_repo", {}).get("cached_mpp_path")

        if not mpp_path:
            cached_dir = self.project_root / "tools" / "morphe-data" / "patches" / f"{owner}-{repo_name}"
            if cached_dir.is_dir():
                mpp_path = next((f for f in cached_dir.iterdir() if f.is_file() and f.name.endswith(".mpp")), None)
                if mpp_path:
                    self.repo_details.setdefault(repo, {}).setdefault("cached_repo", {})["cached_mpp_path"] = mpp_path
                else:
                    logger.warning(f" └── [!] Unable to find cached repo mpp for {owner}")
                    return None
            else:
                return None

        return mpp_path if mpp_path else None

    @staticmethod
    def extract_mpp_version(mpp_path: Path | None) -> str | None:
        """
        Extracts the patch bundle version from the .mpp file (ZIP archive MANIFEST.MF)
        or falls back to regex matching on the filename.
        """
        if not mpp_path or not mpp_path.is_file():
            return None
        try:
            import zipfile
            with zipfile.ZipFile(mpp_path, 'r') as zf:
                if 'META-INF/MANIFEST.MF' in zf.namelist():
                    content = zf.read('META-INF/MANIFEST.MF').decode('utf-8', errors='ignore')
                    for line in content.splitlines():
                        if line.startswith('Version:'):
                            v = line.split(':', 1)[1].strip()
                            if v:
                                return v
        except Exception:
            pass

        # Fallback to filename patterns (e.g. v2.0.0__patches-2.0.0.mpp or patches-1.48.0.mpp)
        m = re.search(r'(?:v)?(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?)\.mpp', mpp_path.name)
        if m:
            return m.group(1)
        m2 = re.search(r'v?(\d+\.\d+(?:\.\d+)?)', mpp_path.name)
        if m2:
            return m2.group(1)
        return None

    def get_patch_version_identifier(self, repos: set[str]) -> str | None:
        """
        Resolves a concise, clean patch version identifier (e.g. 'v2.0.0' or 'v1.48.0')
        for the given patch repositories.
        """
        versions = []
        for repo in sorted(repos):
            owner = self.repo_details.get(repo, {}).get('owner')
            repo_name = self.repo_details.get(repo, {}).get('repo_name')
            mpp_path = self.get_cached_repo_path(owner, repo_name, repo) if (owner and repo_name) else None
            ver = self.extract_mpp_version(mpp_path)
            if not ver:
                tag = self.repo_details.get(repo, {}).get('tag_name')
                if tag:
                    ver = tag.lstrip('v')
            if ver:
                v_str = f"v{ver.lstrip('v')}"
                if v_str not in versions:
                    versions.append(v_str)

        if not versions:
            return None
        return versions[0]

#################################
#           OPTIONS             #
#################################

    def options_main(self) -> tuple[dict[str, dict[str, dict[str, str]]], set[str]]:
        repo_options_locations = self.make_options()
        checksums = self.generate_checksum(repo_options_locations)
        self.write_options_checksum_json(checksums)
        self.enabled_patches_per_app, all_enabled_repos = self.filter_repos()

        return self.enabled_patches_per_app, all_enabled_repos
        
    def make_options(self) -> list[Path]:
        repo_options_locations = []

        for repo in self.repo_search:     
            cached_repo = self.get_cached_repo(repo)  

            if not cached_repo:
                continue

            owner = self.repo_details[repo]['owner']

            logger.info(f"\n[*] Creating options json(s) from cached repo: '{cached_repo.parent.name}/{cached_repo.name}'")  

            for package_name in self.repo_search[repo]:
                app_options_dir = self.options_dir / package_name
                app_options_dir.mkdir(parents=True, exist_ok=True)
                repo_options = app_options_dir / f"{owner}_options.json" 

                if repo_options.is_file() and repo_options.stat().st_size > 0:
                    logger.info(f" └── [✓] Options file '{repo_options.name}' already exists for '{package_name}'.")
                    repo_options_locations.append(repo_options)
                    continue

                opt_cmd = [self.java_bin]
                if not self.low_spec_mode:
                    opt_cmd += ["-Xms256m", "-Xmx1024m", "-Djava.awt.headless=true"]
                opt_cmd += [
                    "-jar",
                    str(self.morphe_location),
                    "options-create",
                    "-p",
                    str(cached_repo),
                    "-o",
                    str(repo_options),
                    "-f",
                    package_name,
                ]
                result = subprocess.run(
                    opt_cmd,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                
                if result.returncode in (130, 143, -2, -15, -9) or result.returncode < 0:
                    logger.critical("\n └── [!] Options creation cancelled by user.")
                    raise KeyboardInterrupt("Cancelled by user")

                if result.returncode == 0:
                    logger.info(f" └── [✓] Created options file: '{repo_options.name}' for '{package_name}'.")
                    repo_options_locations.append(repo_options)
                else:
                    logger.error(f" └── [✗] Failed to create options for '{package_name}' from '{repo}'.")
                    if result.stderr and result.stderr.strip():
                        logger.error(result.stderr.strip())

        return repo_options_locations

    def filter_repos(self) -> tuple[dict[str, dict[str, dict[str, str]]], set[str]]:
        enabled_patches_per_app = {}
        all_enabled_repos = set()

        for app, details in self.detailed_patch_list.items():
            app_options_dir = self.options_dir / app
            for repo in details.get('repos', []):
                owner = self.repo_details.get(repo, {}).get('owner')
                options_file_name = app_options_dir / f"{owner}_options.json"

                if not options_file_name.is_file():
                    continue

                with open(options_file_name, "r", encoding="utf-8") as f:
                    cached_data = json.load(f)

                    if isinstance(cached_data, list) and cached_data:
                        patches_dict = cached_data[-1].get('patches', {})
                    elif isinstance(cached_data, dict):
                        patches_dict = cached_data.get('patches', {})
                    else:
                        patches_dict = {}

                    for patch, values in patches_dict.items():
                        aliase = patch
                        alias_map = self.detailed_patch_list[app].get('patch_aliases', {})
                        if patch in alias_map:
                            aliase = alias_map[patch]

                        if isinstance(values, dict) and values.get('enabled'):
                            enabled_patches_per_app.setdefault(app, {}).setdefault(aliase, {})[repo] = patch
                            all_enabled_repos.add(repo)

        return enabled_patches_per_app, all_enabled_repos

    def generate_checksum(self, repo_options_locations: list[Path]) -> dict[str, str]:
        checksums = {}

        for options_path in repo_options_locations:
            try:
                rel_path = options_path.relative_to(self.options_dir).as_posix()
            except ValueError:
                rel_path = str(options_path)

            try:
                with open(options_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                # get just the last block to avoid only time changes
                if isinstance(data, list) and data:
                    patch_data = data[-1].get("patches", {})
                elif isinstance(data, dict):
                    patch_data = data.get("patches", {})
                else:
                    patch_data = {}

                normalised = json.dumps(patch_data, sort_keys=True, separators=(",", ":"))
                checksums[rel_path] = hashlib.sha256(normalised.encode("utf-8")).hexdigest()
            except Exception as e:
                logger.error(f" └── [!] Failed computing checksum for {options_path}: {e}")

        return checksums
        
    def write_options_checksum_json(self, checksums: dict[str, str]) -> None:
        logger.info("\n[*] Updating option checksum cache...")

        existing_checksums = {}

        if self.options_checksum_json.is_file():
            try:
                with open(
                    self.options_checksum_json, "r", encoding="utf-8"
                ) as f:
                    existing_checksums = json.load(f)
            except Exception as e:
                logger.error(f" └── [!] Failed reading checksum cache: {e}")

        existing_checksums.update(checksums)

        self.options_checksum_json.parent.mkdir(parents=True, exist_ok=True)
        with open(self.options_checksum_json, "w", encoding="utf-8") as f:
            json.dump(existing_checksums, f, indent=2, sort_keys=True)

    @staticmethod
    def sanitize_bundle(bundle: dict) -> dict:
        if not isinstance(bundle, dict):
            return bundle
        meta = bundle.get("meta")
        if isinstance(meta, dict):
            if "repo" in meta and "source" not in meta:
                meta["source"] = meta.pop("repo")
            allowed_meta_keys = {"createdAt", "updatedAt", "source", "sha256"}
            bundle["meta"] = {k: v for k, v in meta.items() if k in allowed_meta_keys}
        return bundle

    def merge_target_repos(self, package_name: str, repos: set[str], version_name: str) -> Path:
        if len(repos) == 1:
            repo_name = next(iter(repos))
            logger.debug(f" └── Only one repo ('{repo_name}') for '{version_name}', package: '{package_name}'")
            options_to_use = self.options_dir / package_name / f"{self.repo_details[repo_name]['owner']}_options.json"
            if options_to_use.is_file():
                try:
                    with open(options_to_use, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        data = [data]
                    if isinstance(data, list):
                        data = [self.sanitize_bundle(b) for b in data]
                        with open(options_to_use, "w", encoding="utf-8") as f:
                            json.dump(data, f, indent=2)
                except Exception as e:
                    logger.warning(f" └── Failed normalizing options file {options_to_use}: {e}")
            return options_to_use

        app_options_dir = self.options_dir / package_name
        output = app_options_dir / f"{package_name}_merge_options_{version_name}.json"
        merged_bundles = []
        seen_shas = set()
        logger.info(f"\n[*] Creating merged options.json for {package_name}...")

        for repo in repos:
            logger.info(f" ├── Merging {repo}...")
            owner = self.repo_details[repo]['owner']
            options_file = app_options_dir / f"{owner}_options.json"

            with open(options_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            if isinstance(data, dict):
                data = [data]

            for block in data:
                block = self.sanitize_bundle(block)
                sha = block.get("meta", {}).get("sha256")
                if sha in seen_shas:
                    logger.info(f"    [!] Skipping duplicate bundle (sha256={sha}) from {owner}")
                    continue
                seen_shas.add(sha)
                merged_bundles.append(block)  # keep meta + patches exactly as generated

        with open(output, "w", encoding="utf-8") as f:
            json.dump(merged_bundles, f, indent=2)

        total_patches = sum(len(b.get("patches", {})) for b in merged_bundles)
        logger.info(f" └── [✓] Merged {len(merged_bundles)} bundles "
            f"({total_patches} patches total) into: {output}")

        return output

    def check_aliase_clash(self, package_name: str, target_version: str, enabled_patches_per_app_versions: dict, options_to_use: Path) -> None:
        with open(options_to_use, "r", encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, dict):
            data = [data]
        entries = [self.sanitize_bundle(b) for b in data] if isinstance(data, list) else []

        for aliase, details in enabled_patches_per_app_versions.items():
            if len(details) > 1:
                logger.info(f" └── [!] Aliase found {aliase}")
                for repo, patch_info in details.items():
                    shas = self.get_sha(repo, package_name)
                    patch_name = patch_info[0]
                    patch_version_name = patch_info[2]

                    for entry in entries:
                        if not isinstance(entry, dict):
                            continue
                        sha = entry.get('meta', {}).get('sha256')

                        if not sha or sha not in shas:
                            continue

                        patches = entry.get('patches', {})
                        if isinstance(patches, dict) and patch_name in patches:
                            is_enabled = patches[patch_name].get('enabled', False)

                            if target_version != patch_version_name and is_enabled:
                                logger.info(f"       └── [!] Disabling {patch_name} in {repo} as version does not match target.")
                                patches[patch_name]['enabled'] = False

                            elif target_version == patch_version_name and not is_enabled:
                                logger.info(f"       └── [!] Enabling {patch_name} in {repo} as version matches target.")
                                patches[patch_name]['enabled'] = True

        with open(options_to_use, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2)

    def get_sha(self, repo: str, package_name: str) -> set[str]:
        shas = set()
        owner = self.repo_details[repo]['owner']
        options_file = self.options_dir / package_name / f"{owner}_options.json"

        with open(options_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        for entry in data:
            if isinstance(entry, dict):
                sha = entry.get('meta', {}).get('sha256')
                if sha:
                    shas.add(sha)

        return shas

#################################
#      GET PATCH VERSOINS       #
#################################

    def get_patch_versions_main(self, enabled_patches_per_app: dict[str, dict[str, dict[str, str]]], enabled_repos: set[str]) -> tuple[dict[str, list[str]], dict[str, dict[str, dict[str, tuple[str, tuple[int, ...], str]]]]]:
        enabled_patches_per_app_versions = self.get_patch_versions(enabled_repos, enabled_patches_per_app)
        package_req = self.find_package_req(enabled_patches_per_app_versions)
        return package_req, enabled_patches_per_app_versions

    def get_patch_versions(self, enabled_repos: set[str], enabled_patches_per_app: dict[str, dict[str, dict[str, str]]]) -> dict[str, dict[str, dict[str, tuple[str, tuple[int, ...], str]]]]: 
        logger.info(f"\n[*] Searching for patches in {len(enabled_repos)} repos:")
        enabled_patches_per_app_versions = {}

        for repo in enabled_repos:
            logger.info(f" ├── {repo}")

            cached_repo = self.get_cached_repo(repo)

            if not cached_repo:
                continue

            list_cmd = [self.java_bin]
            if not self.low_spec_mode:
                list_cmd += ["-Xms256m", "-Xmx1024m", "-Djava.awt.headless=true"]
            list_cmd += [
                "-jar",
                str(self.morphe_location),
                "list-patches",
                "-u",
                "--patches",
                str(cached_repo),
                "--with-packages",
                "--with-versions",
            ]
            result = subprocess.run(
                list_cmd,
                capture_output=True,
                text=True,
                check=False,
            )

            if result.returncode in (130, 143, -2, -15, -9) or result.returncode < 0:
                logger.critical("\n │     └── [!] Patch listing cancelled by user.")
                raise KeyboardInterrupt("Cancelled by user")

            if result.returncode == 0:
                logger.info(f" │     └── [✓] Success!")
                for block in result.stdout.split('Index: ')[1:]:
                    patch_search = re.search(r"Name:\s*(.+)", block)
                    if not patch_search:
                        continue

                    patch_name = patch_search.group(1).strip()
                    package_names = re.findall(r"Package name:\s*(\S+)", block)
                    version_search = re.search(r"Compatible versions:\s*(.+)", block)

                    # 1. Parse versions (take the first listed compatible version or default to (0, 0, 0))
                    if version_search:
                        first_ver_line = version_search.group(1).strip().splitlines()[0]
                        version_digits = re.findall(r"\d+", first_ver_line)
                        tup_ver = tuple(int(d) for d in version_digits) if version_digits else (0, 0, 0)
                        ver_str = first_ver_line.strip() if version_digits else "0.0.0"
                    else:
                        tup_ver = (0, 0, 0)
                        ver_str = "0.0.0"

                    # 2. Package-specific patches
                    if package_names:
                        for pkg in package_names:
                            if pkg in enabled_patches_per_app:
                                for alias, details in enabled_patches_per_app[pkg].items():
                                    if repo in details and details[repo] == patch_name:
                                        enabled_patches_per_app_versions.setdefault(pkg, {}).setdefault(alias, {})[repo] = (patch_name, tup_ver, ver_str)
                    
                    # 3. Genuine universal patches (check if any configured app wants this patch)
                    else:
                        for app_pkg, aliases in enabled_patches_per_app.items():
                            for alias, details in aliases.items():
                                if repo in details and details[repo] == patch_name:
                                    enabled_patches_per_app_versions.setdefault(app_pkg, {}).setdefault(alias, {})[repo] = (patch_name, (0, 0, 0), '0.0.0')

            else:
                err_msg = result.stderr.strip().splitlines()[-1] if result.stderr else "Unknown error"
                logger.error(f" │     └── [✗] Repo search failed (exit code {result.returncode}): {err_msg}")

        return enabled_patches_per_app_versions
     
    def find_package_req(self, enabled_patches_per_app_versions: dict[str, dict[str, dict[str, tuple[str, tuple[int, ...], str]]]]) -> dict[str, list[str]]:
        package_req_tup = {}

        for package_name, aliases  in enabled_patches_per_app_versions.items():
            version = set()
            for aliase_details in aliases.values():
                for repo_detials in aliase_details.values():
                    tup_ver = repo_detials[1]
                    str_ver = repo_detials[2]
                    version.add((tup_ver, str_ver))

            sorted_versions = sorted(version, key=lambda item: item[0], reverse=True)

            package_req_tup[package_name] = [ver_str for _, ver_str in sorted_versions]

        return package_req_tup

#################################
#            PATCH              #
#################################

    def check_options_to_use(self, package_name: str, target_version: str, latest: bool, enabled_patches_per_app_versions: dict, run: int) -> tuple[set[str], Path]:
        if run == 1:
            repos = self.check_repo_reqs(enabled_patches_per_app_versions[package_name], target_version)
            options_to_use = self.merge_target_repos(package_name, repos, target_version)
            self.check_aliase_clash(package_name, target_version, enabled_patches_per_app_versions[package_name], options_to_use)
            logger.debug("run == 1")
        if run == 2:
            target_tuple = tuple(int(x) for x in target_version.split("."))
            repo_per_version = self.check_repo_per_version(enabled_patches_per_app_versions[package_name])
            logger.debug(f"Check options to use, repo per version: {repo_per_version}")
            if latest:
                repos = repo_per_version[(0, 0, 0)] 
            else:
                repos = repo_per_version[target_tuple]
            options_to_use = self.merge_target_repos(package_name, repos, target_version)
            self.check_aliase_clash(package_name, target_version, enabled_patches_per_app_versions[package_name], options_to_use)
            logger.debug("run == 2")

        if len(repos) == 0:
            logger.error(f" └── [✗] No repos found for target version: {target_version}")
            raise ValueError(f"No repos found for target version: {target_version}")

        logger.debug(f"Check options to use: repo_versions/repos:\n{target_version} {repos}")

        return repos, options_to_use

    def check_repo_reqs(self, aliase_details: dict[str, dict[str, tuple[str, tuple[int, ...], str]]], target_version: str) -> set[str]:
        repos = set()
        for aliase, repo_details in aliase_details.items():
            for repo, (patch_name, version_tuple, version_string) in repo_details.items():
                if version_string == target_version:
                    repos.add(repo)
                    break
                else:
                    best_candidate = max(repo_details.items(), key=lambda item: item[1][1])
                    chosen_repo = best_candidate[0]
                    if chosen_repo:
                        repos.add(chosen_repo)
                    else:
                        logger.error(f" └── [!] No repo found for aliase: {aliase}")
        return repos

    def check_repo_per_version(self, aliase_details: dict[str, dict[str, tuple[str, tuple[int, ...], str]]]) -> dict[tuple[int, ...], set[str]]:
        output = {}

        for repo_details in aliase_details.values():
            for repo, val in repo_details.items():
                output.setdefault(val[1], set()).add(repo)

        return output 

    def patch(self, package_name: str, version_name: str, repos: set[str], options_to_use: Path, strat: int, attempt: int, striplibs: bool) -> tuple[bool, Path | str | None, str | None]:
        dest = None

        cmd = [self.java_bin]

        tmp_dir = self.project_root / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        if self.low_spec_mode:
            cmd += ["-Xms256m", "-Xmx1536m", f"-Djava.io.tmpdir={tmp_dir}"]
        else:
            # High-throughput JVM tuning for rapid Dalvik/dex bytecode manipulation & resource rebuilds
            cmd += [
                "-Xms1g",
                "-Xmx4g",
                "-XX:+UseG1GC",
                "-XX:+ParallelRefProcEnabled",
                "-XX:+AlwaysPreTouch",
                "-Djava.awt.headless=true",
                f"-Djava.io.tmpdir={tmp_dir}",
            ]

        cmd += ["-jar", str(self.morphe_location), "patch"]

        if not repos:
            logger.error(" └── [!] Repo list is empty.")
            return False, dest, "Repo list is empty."

        if len(repos) == 1:
            dest = "one_repo" 

        for repo in repos:
            owner = self.repo_details[repo]['owner']
            repo_name = self.repo_details[repo]['repo_name']

            mpp_path = self.get_cached_repo_path(owner, repo_name, repo)

            if not mpp_path:
                raise FileNotFoundError(f"No cached .mpp bundle found for {owner}/{repo_name}")

            cmd += ["--patches", str(mpp_path)]

        if striplibs and self.arch:
            cmd += ["--striplibs", self.arch]

        # Dedicated isolated temporary directory for scratch files (prevents I/O locks during parallel patch runs)
        patch_scratch_dir = tmp_dir / f"scratch_{package_name}_{version_name}"
        patch_scratch_dir.mkdir(parents=True, exist_ok=True)
        cmd += ["-t", str(patch_scratch_dir)]

        # Morphe Patcher 2.0+ optimized bytecode mode
        cmd += ["--bytecode-mode=STRIP_FAST"]

        patch_id = self.get_patch_version_identifier(repos)
        if patch_id:
            apk_filename = f"{package_name}_{version_name}_{patch_id}_patched.apk"
        else:
            apk_filename = f"{package_name}_{version_name}_patched.apk"

        output_dest = self.patched_dir / package_name / version_name / apk_filename
        output_dest.parent.mkdir(parents=True, exist_ok=True)
        result_dest = output_dest.parent / "result.json"
        input_package = self.original_dir / package_name / version_name / f"{package_name}.xapk"

        if not input_package.is_file():
            input_package = self.original_dir / package_name / version_name / f"{package_name}.apk"

        if not input_package.is_file():
            target_dir = self.original_dir / package_name / version_name
            if target_dir.is_dir():
                input_package = next(target_dir.glob("*.xapk"), None) or next(target_dir.glob("*.apk"), None)

        if not input_package or not input_package.is_file():
            logger.error(f"No apk or xapk found for {package_name}, version: {version_name}")
            return False, dest, f"No APK or XAPK found for {package_name} v{version_name}"

        if package_name == "com.instaprime.android":
            self.harden_instaprime_binary(input_package)

        cmd += [
            "--keystore", str(self.keystore_path),
            "--keystore-entry-alias", self.keystore_alias,
            "--keystore-password", self.keystore_password,
            "--keystore-entry-password", self.keystore_entry_password,
            "--result-file", str(result_dest),
            "--options-file", str(options_to_use)
        ]

        if strat == 1:
            cmd += ["--force"]

        cmd += ["--out", str(output_dest), str(input_package)]

        try:
            logger.info(f"[*] Attempting to patch package: {package_name}, version: {version_name}...")
            logger.debug(f"Patch command:\n{cmd}\n")
            subprocess.run(cmd, capture_output=True, text=True, check=True)

            if output_dest.is_file():
                logger.info(f" └── [✓] Successfully patched {package_name} v{version_name}")
                self.write_patched_json(package_name, version_name, repos, strat, attempt, options_to_use, output_dest, result_dest, patch_id)
                return True, output_dest, None
            else:
                logger.error(" └── [!] Java exited with code 0, but output APK was not found.")
                return False, dest, "Java exited with code 0, but output APK was not found."

        except subprocess.CalledProcessError as e:
            if e.returncode in (130, 143, -2, -15, -9) or e.returncode < 0:
                logger.critical("\n └── [!] Patch process cancelled by user.")
                raise KeyboardInterrupt("Patching interrupted by user")
            error_msg = next((line.strip() for line in e.stderr.splitlines() if line.strip()), "Unknown CLI error") if e.stderr else "Unknown CLI error"
            logger.error(f" └── [!] Morphe CLI failed (exit code {e.returncode}): {error_msg}")
            return False, dest, f"Morphe CLI failed (exit code {e.returncode}): {error_msg}"

        except FileNotFoundError:
            logger.error(" └── [!] Java executable not found. Ensure Java is installed and on your PATH.")
            return False, dest, "Java executable not found."

        except KeyboardInterrupt:
            logger.critical("\n └── [!] Patch process cancelled by user.")
            raise

#################################
#      Write Patched Json       #
#################################

    def write_patched_json(self, package_name: str, version_name: str, repos: set[str], strat: int, attempt: int, options_to_use: Path, output: Path, result_dset: Path, patch_version: str | None = None) -> None:
        attempt += 1
        patched_json = self.state_dir / "patched.json"
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        patched_data = {}
        applied_patches = {}
        patch_aliases = {}

        try:
            with open(result_dset, "r", encoding="utf-8") as r:
                results = json.load(r)
        except json.JSONDecodeError:
            logger.warning(f"Unable to open results file for {package_name} v{version_name}")
            pass

        if results:
            applied_patches_res = results.get('appliedPatches')
            
            if applied_patches_res:  
                bundles = []

                if len(repos) > 1:
                    with open(options_to_use, "r", encoding="utf-8") as f:
                        try:
                            bundles = json.load(f)
                        except json.JSONDecodeError:
                            logger.warning(f"Unable to open options file for {package_name}: {options_to_use}")

                    target_shas = {}

                    for r in repos:
                        cached_repo = self.repo_details[r]['cached_repo']['cached_mpp_path']
                        sha = self.repo_details[r].get("sha")
                        if not sha:
                            sha = self.make_sha(cached_repo)
                            self.repo_details[r]["sha"] = sha
                        target_shas[sha] = r

                for patch_name in applied_patches_res:

                    if len(repos) > 1:
                        if bundles:
                            repo = self.find_repo(patch_name, bundles, target_shas)
                        else:
                            repo = "Unable to find repo"
                    else:
                        repo = next(iter(repos))

                    applied_patches[patch_name] = repo

        if patched_json.is_file():
                try:
                    with open(patched_json, "r", encoding="utf-8") as p:
                        patched_data = json.load(p)
                except json.JSONDecodeError:
                    pass

        for p, aliase in self.detailed_patch_list[package_name].get("patch_aliases", {}).items():
            if aliase:
                patch_aliases.setdefault(aliase, []).append(p)

        package_sha = self.make_sha(output)

        package_size = self.get_size(output)
        
        entry = {
            'applied_patches': applied_patches,
            'patch_aliases': patch_aliases,
            'location': str(output),
            'filename': output.name,
            **package_size,
            'sha256': package_sha,
            'repos': list(repos),
            'strat': strat,
            'attempt': attempt,
            'arch': self.arch,
            'time': timestamp
        }
        if patch_version:
            entry['patch_version'] = patch_version

        patched_data.setdefault(package_name, {})[version_name] = entry

        with open(patched_json, "w", encoding="utf-8") as f:
            json.dump(patched_data, f, indent=2)

    def find_repo(self, patch: str, bundles: list[dict], target_shas: dict[str, str]) -> str:
        for bundle in bundles:
            patch_data = bundle.get("patches", {}).get(patch)
            if patch_data and patch_data.get("enabled"):
                found_sha = bundle.get("meta", {}).get("sha256")
                if found_sha in target_shas:
                    return target_shas[found_sha]
            
        return "Unable to find repo"

    def make_sha(self, item: Path) -> str:
        sha = hashlib.sha256()

        with open(item, "rb") as f:
            while chunk := f.read(65536):
                sha.update(chunk)

        return sha.hexdigest()

    def get_size(self, package: Path) -> dict[str, int | str]:
        size_in_bytes = package.stat().st_size
        size = {'size_bytes': size_in_bytes}

        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if size_in_bytes < 1024:
                size['file_size'] = f"{size_in_bytes:.2f} {unit}"
                return size
            size_in_bytes /= 1024