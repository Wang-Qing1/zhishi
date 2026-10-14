use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Kb {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub card_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub kb_id: i64,
    pub name: String,
    pub color: String,
    pub card_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: i64,
    pub kb_id: i64,
    pub title: String,
    pub content_json: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    pub id: i64,
    pub kb_id: i64,
    pub title: String,
    pub excerpt: String,
    pub updated_at: i64,
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: i64,
    pub kb_id: i64,
    pub src_id: i64,
    pub dst_id: i64,
    pub src_title: String,
    pub dst_title: String,
    pub relation_type: String,
    pub note: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: i64,
    pub title: String,
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<Link>,
}

/// snippet 中命中部分以 \u{1} ... \u{2} 包裹,由前端安全高亮(避免注入 HTML)
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub card_id: i64,
    pub kb_id: i64,
    pub kb_name: String,
    pub title: String,
    pub snippet: String,
    pub tags: Vec<Tag>,
}
