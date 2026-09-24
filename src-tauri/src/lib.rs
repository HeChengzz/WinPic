/* =========================================================
依赖
========================================================= */
use image::{ImageFormat, ImageReader};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/* =========================================================
平台特定实现
========================================================= */
#[cfg(target_os = "windows")]
mod win {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn SystemParametersInfoW(
            ui_action: u32,
            ui_param: u32,
            pv_param: *mut c_void,
            f_win_ini: u32,
        ) -> i32;
    }

    const SPI_SETDESKWALLPAPER: u32 = 20;
    const SPIF_UPDATEINIFILE: u32 = 0x01;
    const SPIF_SENDCHANGE: u32 = 0x02;

    pub fn set_wallpaper(path: &str) -> Result<(), String> {
        if !std::path::Path::new(path).exists() {
            return Err(format!("文件不存在：{}", path));
        }

        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let ok = unsafe {
            SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                wide.as_ptr() as *mut c_void,
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
            )
        };

        if ok == 0 {
            return Err("SystemParametersInfoW 调用失败".to_string());
        }
        Ok(())
    }
}

/* =========================================================
通用工具
========================================================= */

/// exe 所在目录
fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("无法获取 exe 路径：{}", e))?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法获取 exe 目录".to_string())
}

/// 数据根目录：<exe目录>/data
fn data_dir() -> Result<PathBuf, String> {
    Ok(exe_dir()?.join("data"))
}

/// 缩略图缓存目录：<exe目录>/data/thumbnails
fn thumb_cache_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("thumbnails"))
}

/// 状态文件路径：<exe目录>/data/state.json
fn state_file() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("state.json"))
}

/// 生成"先写临时文件再原子替换"的路径
fn tmp_path_for(src: &Path) -> Result<PathBuf, String> {
    let parent = src.parent().ok_or_else(|| "无效路径".to_string())?;
    let name = src
        .file_name()
        .ok_or_else(|| "无效文件名".to_string())?
        .to_string_lossy()
        .to_string();
    Ok(parent.join(format!(".{}.tmp", name)))
}

/// 先写临时文件，再原子替换原文件
fn write_atomic(src: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = tmp_path_for(src)?;
    if let Err(e) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("写入临时文件失败：{}", e));
    }
    if let Err(e) = fs::rename(&tmp, src) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换原文件失败：{}", e));
    }
    Ok(())
}

/// FNV-1a 简单哈希，用于缩略图缓存 key
fn simple_hash(s: &str) -> String {
    let mut h: u64 = 14695981039346656037;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("{:x}", h)
}

/* =========================================================
命令：壁纸
========================================================= */
#[tauri::command]
fn set_wallpaper(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win::set_wallpaper(&path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("当前平台暂不支持设置壁纸".to_string())
    }
}

/* =========================================================
命令：以其他应用打开
========================================================= */
#[tauri::command]
fn open_with(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &path])
            .spawn()
            .map_err(|e| format!("打开对话框失败：{}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("当前平台暂不支持".to_string())
    }
}

/* =========================================================
命令：重命名文件
========================================================= */
#[tauri::command]
fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    let p = Path::new(&old_path);
    let parent = p.parent().ok_or_else(|| "无法获取父目录".to_string())?;

    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
    let new_filename = if ext.is_empty() {
        new_name.clone()
    } else {
        format!("{}.{}", new_name, ext)
    };

    let new_path = parent.join(&new_filename);

    if new_path.exists() {
        return Err(format!("「{}」已存在", new_filename));
    }

    fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败：{}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

/* =========================================================
命令：重命名文件夹
========================================================= */
#[tauri::command]
fn rename_folder(old_path: String, new_name: String) -> Result<String, String> {
    let p = PathBuf::from(&old_path);
    if !p.is_dir() {
        return Err("目标不是目录".into());
    }

    if new_name.is_empty() {
        return Err("名称不能为空".into());
    }
    if new_name == "." || new_name == ".." {
        return Err("名称无效".into());
    }
    if new_name.contains(|c: char| "\\/:*?\"<>|".contains(c)) {
        return Err("名称不能包含 \\ / : * ? \" < > |".into());
    }

    let parent = p.parent().ok_or_else(|| "无法获取父目录".to_string())?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("「{}」已存在", new_name));
    }

    fs::rename(&p, &new_path).map_err(|e| format!("重命名失败：{}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

/* =========================================================
命令：新建文件夹
========================================================= */
#[tauri::command]
fn create_folder(parent_dir: String, name: String) -> Result<String, String> {
    let parent = PathBuf::from(&parent_dir);
    if !parent.is_dir() {
        return Err("父目录不存在".into());
    }

    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if name == "." || name == ".." {
        return Err("名称无效".into());
    }
    if name.contains(|c: char| "\\/:*?\"<>|".contains(c)) {
        return Err("名称不能包含 \\ / : * ? \" < > |".into());
    }

    let new_path = parent.join(&name);
    if new_path.exists() {
        return Err(format!("「{}」已存在", name));
    }

    fs::create_dir(&new_path).map_err(|e| format!("创建目录失败：{}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

/* =========================================================
命令：缩略图（带磁盘缓存）
========================================================= */
#[tauri::command]
async fn get_thumbnail(path: String, size: u32) -> Result<String, String> {
    let cache_dir = thumb_cache_dir()?;
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let mtime = fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let key = format!("{}_{}_{}", simple_hash(&path), mtime, size);
    let cache_path = cache_dir.join(format!("{}.jpg", key));

    if cache_path.exists() {
        return Ok(cache_path.to_string_lossy().to_string());
    }

    let cache_path_clone = cache_path.clone();
    let path_clone = path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let img = ImageReader::open(&path_clone)
            .map_err(|e| format!("打开文件失败：{}", e))?
            .with_guessed_format()
            .map_err(|e| format!("识别格式失败：{}", e))?
            .decode()
            .map_err(|e| format!("解码失败：{}", e))?;

        let thumb = img.thumbnail(size, size);
        thumb
            .save_with_format(&cache_path_clone, ImageFormat::Jpeg)
            .map_err(|e| format!("保存缩略图失败：{}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(cache_path.to_string_lossy().to_string())
}

/* =========================================================
命令：重命名后复用缩略图缓存
========================================================= */
#[tauri::command]
fn rename_thumbnail_cache(
    old_paths: Vec<String>,
    new_paths: Vec<String>,
    size: u32,
) -> Result<(), String> {
    if old_paths.len() != new_paths.len() {
        return Err("参数长度不匹配".into());
    }

    let cache_dir = thumb_cache_dir()?;
    if !cache_dir.exists() {
        return Ok(());
    }

    for i in 0..old_paths.len() {
        let old_path = &old_paths[i];
        let new_path = &new_paths[i];

        let mtime = match fs::metadata(new_path) {
            Ok(m) => m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
            Err(_) => continue,
        };

        let old_key = format!("{}_{}_{}", simple_hash(old_path), mtime, size);
        let new_key = format!("{}_{}_{}", simple_hash(new_path), mtime, size);

        let old_cache = cache_dir.join(format!("{}.jpg", old_key));
        let new_cache = cache_dir.join(format!("{}.jpg", new_key));

        if old_cache.exists() && !new_cache.exists() {
            let _ = fs::rename(&old_cache, &new_cache);
        }
    }

    Ok(())
}

/* =========================================================
命令：在资源管理器中显示
========================================================= */
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = p.parent().unwrap_or(&p);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/* =========================================================
命令：删除到回收站
========================================================= */
#[tauri::command]
fn delete_to_trash(paths: Vec<String>) -> Result<(), String> {
    trash::delete_all(&paths).map_err(|e| e.to_string())
}

/* =========================================================
命令：移动文件
========================================================= */
#[tauri::command]
fn move_file(src: String, dst_dir: String) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let dst_dir_path = PathBuf::from(&dst_dir);

    if !src_path.exists() {
        return Err("源文件不存在".into());
    }
    if !dst_dir_path.is_dir() {
        return Err("目标不是目录".into());
    }

    let file_name = src_path
        .file_name()
        .ok_or("无效文件名")?
        .to_string_lossy()
        .to_string();

    let mut dst = dst_dir_path.join(&file_name);

    if dst.exists() {
        let stem = PathBuf::from(&file_name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = PathBuf::from(&file_name)
            .extension()
            .map(|s| format!(".{}", s.to_string_lossy()))
            .unwrap_or_default();
        let mut i = 1;
        loop {
            dst = dst_dir_path.join(format!("{} ({}){}", stem, i, ext));
            if !dst.exists() {
                break;
            }
            i += 1;
            if i > 9999 {
                return Err("无法生成唯一文件名".into());
            }
        }
    }

    if fs::rename(&src_path, &dst).is_err() {
        fs::copy(&src_path, &dst).map_err(|e| e.to_string())?;
        fs::remove_file(&src_path).map_err(|e| e.to_string())?;
    }

    Ok(dst.to_string_lossy().to_string())
}

/* =========================================================
命令：保存旋转（覆盖原文件）
========================================================= */
#[tauri::command]
fn rotate_image(path: String, degrees: u16) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("文件不存在".into());
    }

    let deg = degrees % 360;
    if deg == 0 {
        return Ok(());
    }
    if deg != 90 && deg != 180 && deg != 270 {
        return Err("仅支持 90 / 180 / 270 度".into());
    }

    let img = ImageReader::open(&src)
        .map_err(|e| format!("读取图片失败：{}", e))?
        .with_guessed_format()
        .map_err(|e| format!("识别格式失败：{}", e))?
        .decode()
        .map_err(|e| format!("解码失败：{}", e))?;

    let rotated = match deg {
        90  => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _   => unreachable!(),
    };

    let format = ImageFormat::from_path(&src)
        .map_err(|e| format!("无法识别图片格式：{}", e))?;

    let mut buf: Vec<u8> = Vec::new();
    rotated
        .write_to(&mut std::io::Cursor::new(&mut buf), format)
        .map_err(|e| format!("编码失败：{}", e))?;

    write_atomic(&src, &buf)
}

/* =========================================================
命令：读取状态文件
========================================================= */
#[tauri::command]
fn load_state_file() -> Result<Option<String>, String> {
    let path = state_file()?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("读取状态文件失败：{}", e))
}

/* =========================================================
命令：写入状态文件
========================================================= */
#[tauri::command]
fn save_state_file(content: String) -> Result<(), String> {
    let path = state_file()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建数据目录失败：{}", e))?;
    }

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content.as_bytes())
        .map_err(|e| format!("写入失败：{}", e))?;

    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换状态文件失败：{}", e));
    }

    Ok(())
}

/* =========================================================
入口
========================================================= */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_thumbnail,
            rename_thumbnail_cache,
            rename_file,
            rename_folder,
            create_folder,
            move_file,
            delete_to_trash,
            reveal_in_explorer,
            rotate_image,
            set_wallpaper,
            open_with,
            load_state_file,
            save_state_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}