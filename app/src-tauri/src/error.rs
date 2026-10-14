use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Msg(String),
    #[error("未找到: {0}")]
    NotFound(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }

    /// 约束冲突(唯一/外键/CHECK)转成友好提示,其余保持原错误
    pub fn from_constraint(e: rusqlite::Error, msg: &str) -> Self {
        match &e {
            rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
                AppError::Msg(msg.to_string())
            }
            _ => AppError::Db(e),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
